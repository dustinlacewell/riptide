/**
 * The last volume tree of each drive, held between requests and brought up
 * to date from the NTFS change journal instead of read again.
 *
 *   get(drive, opts)   the drive's tree: {tree, how, changes, ms, reason}
 *                      how is "delta" when the journal updated a kept
 *                      tree, "full" when the whole MFT was read
 *   peek(drive)        the tree held, without reading; null when none
 *   onChanged(fn)      fn(drive, {dirtyDirs, version}) after each update
 *   bytesPerDrive()    memory estimate from the last full read, or null
 *
 * A full read happens when nothing is kept, when the kept tree lacks a
 * file pattern the caller needs, when the caller asks for one, and when
 * the journal cannot vouch for the gap (apply.js staleReason, or more than
 * MAX_CHANGES records changed).
 *
 * After a full read the tree's journal position is set to a USN from just
 * before the read began, so the next update replays whatever changed while
 * the MFT was streaming. Replaying a change is harmless (apply.js).
 *
 * How many drives are held is the shared keep limit (keep.js). At 0
 * nothing is held and every get reads the whole MFT.
 *
 * One writer per drive: a get waits for the one before it on the same
 * drive. All I/O of an update happens before the tree is touched, and the
 * tree is then changed in one synchronous step — a stopped update leaves
 * the tree as it was. Callers use a tree synchronously after get resolves.
 */

import { createKeep, keyOf } from "../keep.js";
import { parseBootSector } from "./boot.js";
import { queryIds } from "./filenames.js";
import { driveBytes } from "./footprint.js";
import { MAX_CHANGES, applyChanges, changedRecords, staleReason } from "./apply.js";
import { findUsnAt, readChanges, readJournalInfo } from "./journal.js";
import { readEntries } from "./reread.js";
import { readMftRuns, readTreeFrom } from "./scan.js";
import { recordsIn } from "./stream.js";
import { runsToByteRanges } from "./runlist.js";
import { openVolume } from "./volume.js";

const now = () => performance.now();

// How far before a full read to start its journal replay: a margin for the
// gap between our clock read and the first record's time stamp.
const REPLAY_MARGIN_MS = 2_000;

/**
 * @param {{keep?: ReturnType<typeof createKeep>, open?: typeof openVolume,
 *          clock?: () => number, wallClock?: () => number}} [opts]
 *   open is injected so tests read a synthetic volume; clock times the
 *   work, wallClock (Unix ms) is compared with journal time stamps
 */
export function createTreeCache({
  keep = createKeep(),
  open = openVolume,
  clock = now,
  wallClock = Date.now,
} = {}) {
  const held = new Map(); // drive -> tree
  const queues = new Map(); // drive -> tail of its get chain
  const listeners = new Set();
  let lastBytes = null;

  keep.register({ holds: (drive) => held.has(drive), evict: (drive) => held.delete(drive) });

  /**
   * @param {string} drive e.g. "C:"
   * @param {{query?: object|null, signal?: AbortSignal, full?: boolean,
   *          onProgress?: (n: object) => void, countMatch?: Function}} [opts]
   * @returns {Promise<{tree: object, how: "full"|"delta", changes: number,
   *                    ms: number, reason: string|null}>} reason says why
   *   a full read was needed, when one was not asked for
   */
  function get(drive, opts = {}) {
    const key = keyOf(drive);
    const run = (queues.get(key) ?? Promise.resolve()).then(() => refresh(key, opts));
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  }

  async function refresh(key, opts) {
    opts.signal?.throwIfAborted();
    const started = clock();
    const kept = held.get(key);
    const wanted = queryIds(opts.query ?? null);

    let reason = null;
    if (kept && !opts.full && !kept.journal) {
      reason = "the drive had no change journal";
    } else if (kept && !opts.full && covers(kept.queryIds, wanted)) {
      const updated = await tryUpdate(key, kept, opts);
      if (updated.done) return { tree: kept, how: "delta", reason: null, ms: clock() - started, changes: updated.changes };
      reason = updated.reason;
    } else if (kept && !opts.full) {
      reason = "a file pattern was added";
    }

    // Whatever was kept cannot be trusted past this point.
    held.delete(key);
    const tree = await readFull(key, opts);
    return { tree, how: "full", reason, changes: 0, ms: clock() - started };
  }

  /**
   * An update that fails for any reason but a stop is a reason for a full
   * read, not a failed request: the full read is the path that always works.
   */
  async function tryUpdate(key, kept, opts) {
    try {
      return await update(key, kept, opts);
    } catch (err) {
      opts.signal?.throwIfAborted();
      return { done: false, reason: `the journal update failed: ${err.message}` };
    }
  }

  /**
   * Bring a kept tree up to date. Returns {done: false, reason} when only
   * a full read will do.
   */
  async function update(key, kept, { signal, onProgress = () => {} }) {
    const started = clock();
    onProgress({ stage: "journal", drive: key });
    const volume = await open(key);
    let plan;
    try {
      plan = await planUpdate(volume, kept, signal);
    } finally {
      await volume.close();
    }
    if (plan.reason) return { done: false, reason: plan.reason };
    signal?.throwIfAborted();

    // No awaits from here: the tree changes in one step.
    const { dirtyDirs } = applyChanges(kept, plan.numbers, plan.entries);
    kept.mftRuns = plan.mftRuns;
    kept.recordsTotal = Math.max(kept.recordsTotal ?? 0, plan.recordsTotal);
    kept.journal = { id: plan.info.id, nextUsn: plan.info.nextUsn };
    kept.recent = plan.recent;
    kept.version = (kept.version ?? 0) + 1;
    keep.touch(key);

    const changes = plan.numbers.size;
    onProgress({ stage: "mft-delta", drive: key, changes, ms: clock() - started });
    if (dirtyDirs.size > 0) emit(key, { dirtyDirs, version: kept.version });
    return { done: true, changes };
  }

  /** All the reading an update needs, before anything is changed. */
  async function planUpdate({ read }, kept, signal) {
    const boot = parseBootSector(await read(0n, 512));
    const mftRuns = await readMftRuns(read, boot);
    const info = await readJournalInfo({ read, boot, mftRuns, record: kept.journalRecord, signal });
    const reason = staleReason(kept, { serial: boot.serial, info });
    if (reason) return { reason };

    const changes = await readChanges({ read, boot, info, from: kept.journal.nextUsn, signal });
    const { numbers, recent } = changedRecords(changes, { recent: kept.recent, now: wallClock() });
    if (numbers.size > MAX_CHANGES) return { reason: `more than ${MAX_CHANGES.toLocaleString()} records changed` };

    const { entries, torn } = await readEntries({ read, boot, mftRuns, numbers, signal });
    const { recordsTotal } = recordsIn(runsToByteRanges(mftRuns, boot.bytesPerCluster), boot.bytesPerFileRecord);
    // A torn record is read again next time rather than guessed at now.
    return { reason: null, info, mftRuns, numbers, entries, recent: [...recent, ...torn], recordsTotal };
  }

  async function readFull(key, { query = null, signal, onProgress, countMatch } = {}) {
    signal?.throwIfAborted();
    const began = wallClock();
    const volume = await open(key);
    try {
      const tree = await readTreeFrom(volume, key, { query, signal, onProgress, countMatch, clock });
      tree.queryIds = queryIds(query);
      tree.journal = await journalStart(volume, tree, began - REPLAY_MARGIN_MS);
      tree.recent = [];
      tree.version = 0;
      lastBytes = driveBytes(tree);
      held.set(key, tree);
      keep.touch(key);
      return tree;
    } finally {
      await volume.close();
    }
  }

  /** Where the next update starts reading the journal; null when none. */
  async function journalStart({ read }, tree, time) {
    const info = await readJournalInfo({
      read,
      boot: tree.boot,
      mftRuns: tree.mftRuns,
      record: tree.journalRecord,
    });
    if (!info) return null;
    return { id: info.id, nextUsn: await findUsnAt({ read, boot: tree.boot, info, time }) };
  }

  function emit(drive, change) {
    for (const fn of listeners) fn(drive, change);
  }

  return {
    get,
    peek: (drive) => held.get(keyOf(drive)) ?? null,
    bytesPerDrive: () => lastBytes,
    onChanged(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * A readTree for scan, caches and the map: the cached tree, with the
 * read's timing on it the way readVolumeTree reports it.
 *
 * @param {ReturnType<typeof createTreeCache>} cache
 * @param {{query?: object|null, full?: boolean}} [opts] query is the
 *        standing query, merged into every read's own; full skips any
 *        update and reads the whole MFT
 */
export function readerOf(cache, { query = null, full = false } = {}) {
  return async (drive, opts = {}) => {
    const { tree, how, changes, ms } = await cache.get(drive, {
      ...opts,
      full,
      query: mergeQueries(opts.query ?? null, query),
    });
    return { ...tree, readMs: ms, how, changes };
  };
}

/**
 * Both queries' names and extensions; null when both ask nothing.
 *
 * @param {{exact: Set<string>, ext: Set<string>}|null} a
 * @param {{exact: Set<string>, ext: Set<string>}|null} b
 */
export function mergeQueries(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { exact: new Set([...a.exact, ...b.exact]), ext: new Set([...a.ext, ...b.ext]) };
}

function covers(have, want) {
  const held = new Set(have);
  return want.every((id) => held.has(id));
}
