/**
 * Volume scanning: the imperative shell around the pure MFT parsers.
 *
 * Two strategies:
 *
 *   mft  — open the raw volume, stream the MFT, rebuild the tree. Fast:
 *          one big sequential read instead of millions of directory reads.
 *          Needs a raw volume handle, which the OS may refuse.
 *
 *   walk — ordinary recursive directory read, pruning at each match so we
 *          never descend into the matched subtree. Always available.
 *
 * scanVolume() tries mft and falls back to walk, reporting which ran.
 *
 * Every loop takes an optional AbortSignal and checks it between chunks or
 * directory levels. An aborted run throws the signal's reason, closes what
 * it opened, and never falls back to the other strategy.
 *
 * Progress stages, in order:
 *
 *   mft:  boot, mft-header {recordsTotal, mftBytes}, mft-stream {...},
 *         mft-done {recordsDone, recordsTotal, readMs}, index, size
 *   walk: mft-unavailable {reason}, walk {dirs, matches},
 *         sizing {done, total}
 */

import fsp from "node:fs/promises";
import path from "node:path";

import { parseBootSector } from "./boot.js";
import { runsToByteRanges } from "./runlist.js";
import { applyFixup, extractMftRuns } from "./record.js";
import { recordsIn, streamMftRecords } from "./stream.js";
import { openVolume } from "./volume.js";
import {
  resolvePath,
  subtreeSizes,
  findOutermostMatches,
} from "./tree.js";

const now = () => performance.now();

/**
 * @param {{root: string, matches: (name: string) => boolean,
 *          countMatch?: (name: string) => boolean,
 *          onProgress?: (n: {stage: string}) => void,
 *          signal?: AbortSignal, clock?: () => number,
 *          readTree?: typeof readVolumeTree}} opts
 *   countMatch, when given, makes the MFT stream report a running match
 *   count. It may be the same test as matches. readTree defaults to a
 *   fresh MFT read; the server passes its tree cache.
 * @returns {Promise<{strategy: "mft"|"walk", reason?: string,
 *                    hits: Array<{path: string, bytes: string, files: number,
 *                                 mtime: number|null}>,
 *   mtime is the folder's own modified time, Unix ms.
 *                    stats: {records: number, readMs: number,
 *                            indexMs: number, sizeMs: number}}>}
 */
export async function scanVolume({
  root,
  matches,
  countMatch,
  onProgress = () => {},
  signal,
  clock = now,
  readTree = readVolumeTree,
}) {
  const drive = driveLetterOf(root);
  const opts = { root, matches, countMatch, onProgress, signal, clock, readTree };

  if (drive) {
    try {
      return { strategy: "mft", ...(await scanViaMft({ ...opts, drive })) };
    } catch (err) {
      // A stop is not a failed MFT read; walking the tree instead would
      // carry on with the work the caller just cancelled.
      signal?.throwIfAborted();
      onProgress({ stage: "mft-unavailable", reason: err.message });
      return { strategy: "walk", reason: err.message, ...(await scanViaWalk(opts)) };
    }
  }

  return {
    strategy: "walk",
    reason: "root is not a drive path",
    ...(await scanViaWalk(opts)),
  };
}

// ---------------------------------------------------------------------------
// MFT strategy
// ---------------------------------------------------------------------------

async function scanViaMft({ drive, root, matches, countMatch, onProgress, signal, clock, readTree }) {
  const tree = await readTree(drive, { onProgress, signal, countMatch, clock });

  const indexStart = clock();
  onProgress({ stage: "index" });
  const resolved = matchHits({ ...tree, root, matches });

  const sizeStart = clock();
  onProgress({ stage: "size" });
  const hits = sizeHits(tree, resolved);

  return {
    hits,
    stats: {
      records: tree.recordsDone,
      readMs: tree.readMs,
      indexMs: sizeStart - indexStart,
      sizeMs: clock() - sizeStart,
    },
  };
}

/**
 * Read one volume's MFT and return its directory tree.
 *
 * Separate from scanVolume because sizing a known set of paths (the cache
 * tab) needs the same read but not the name matching. One sequential pass
 * over the MFT answers both questions.
 *
 * With a file-name query (see filenames.js), each file whose name matches
 * marks its parent directory, so a caller can ask "which folders hold a
 * Cargo.toml?" from the same read. Without one, files cost nothing extra.
 *
 * @param {string} drive e.g. "C:"
 * @param {{onProgress?: Function,
 *          query?: {exact: Set<string>, ext: Set<string>}|null,
 *          countMatch?: (name: string) => boolean,
 *          signal?: AbortSignal, clock?: () => number}} [opts]
 * @returns {Promise<ReturnType<typeof readTreeFrom>>}
 */
export async function readVolumeTree(drive, opts = {}) {
  opts.signal?.throwIfAborted();
  const volume = await openVolume(drive);
  try {
    return await readTreeFrom(volume, drive, opts);
  } finally {
    await volume.close();
  }
}

/**
 * readVolumeTree on a volume already open.
 *
 * @param {{read: (offset: bigint, length: number) => Promise<Buffer>}} volume
 * @param {string} drive
 * @param {object} [opts] as readVolumeTree
 * @returns {Promise<object>} the tree fold.js describes, plus drive,
 *   recordsDone, recordsTotal, readMs, and the geometry a later update
 *   needs: boot and mftRuns
 */
export async function readTreeFrom(
  { read },
  drive,
  { onProgress = () => {}, query = null, countMatch = null, signal, clock = now } = {},
) {
  signal?.throwIfAborted();
  const started = clock();

  onProgress({ stage: "boot" });
  const boot = parseBootSector(await read(0n, 512));
  const mftRuns = await readMftRuns(read, boot);
  const ranges = runsToByteRanges(mftRuns, boot.bytesPerCluster);

  const { recordsTotal, mftBytes } = recordsIn(ranges, boot.bytesPerFileRecord);
  onProgress({ stage: "mft-header", recordsTotal, mftBytes: Number(mftBytes) });

  const tree = await streamMftRecords({
    read,
    ranges,
    boot,
    query,
    countMatch,
    onProgress,
    signal,
    clock,
  });

  const readMs = clock() - started;
  onProgress({ stage: "mft-done", recordsDone: tree.recordsDone, recordsTotal, readMs });

  return Object.assign(tree, { drive, recordsTotal, readMs, boot, mftRuns });
}

/**
 * Where the MFT lives: the run list of record 0's $DATA.
 *
 * @param {(offset: bigint, length: number) => Promise<Buffer>} read
 * @param {ReturnType<typeof parseBootSector>} boot
 */
export async function readMftRuns(read, boot) {
  const zeroRecord = await read(boot.mftOffset, boot.bytesPerFileRecord);
  applyFixup(zeroRecord, boot.bytesPerSector);
  return extractMftRuns(zeroRecord);
}

/** The outermost matching directories under root, with their full paths. */
function matchHits({ dirs, drive, root, matches }) {
  const wanted = normalize(root);
  const resolved = [];

  for (const rec of findOutermostMatches(dirs, matches)) {
    const full = resolvePath(dirs, rec, drive);
    if (!full) continue;
    if (!normalize(full).startsWith(wanted)) continue;
    resolved.push({ record: rec, path: full });
  }
  return resolved;
}

function sizeHits({ dirs, ownBytes, ownFiles }, resolved) {
  const totals = subtreeSizes(
    dirs,
    ownBytes,
    ownFiles,
    resolved.map((r) => r.record.recordNumber),
  );

  return resolved
    .map(({ record, path: full }) => {
      const total = totals.get(record.recordNumber) ?? { bytes: 0n, files: 0 };
      return {
        path: full,
        bytes: total.bytes.toString(),
        files: total.files,
        mtime: record.mtime,
      };
    })
    .sort(bySizeDescending);
}

// ---------------------------------------------------------------------------
// Walk strategy
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{hits: object[], stats: {records: number, readMs: number,
 *                    indexMs: number, sizeMs: number}}>}
 *   records counts the directories read.
 */
export async function scanViaWalk({ root, matches, onProgress = () => {}, signal, clock = now }) {
  const started = clock();
  const found = [];
  let level = [root];
  let visited = 0;

  // Find every match first, then size them. Sizing is the expensive half and
  // is better done in one concurrent batch than interleaved with the walk.
  while (level.length > 0) {
    signal?.throwIfAborted();
    const reads = await Promise.all(level.map(readDirSafe));
    const next = [];

    for (const { dir, entries } of reads) {
      visited += 1;
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);

        if (matches(entry.name)) {
          // Prune: do not descend. A nested match lives inside this subtree
          // and is already covered by deleting this one.
          found.push(full);
        } else {
          next.push(full);
        }
      }
    }

    onProgress({ stage: "walk", dirs: visited, matches: found.length });
    level = next;
  }

  const sizeStart = clock();
  onProgress({ stage: "sizing", done: 0, total: found.length });

  const hits = [];
  for (const batch of chunk(found, 8)) {
    signal?.throwIfAborted();
    hits.push(...(await Promise.all(batch.map((dir) => measureSubtree(dir, signal)))));
    onProgress({ stage: "sizing", done: hits.length, total: found.length });
  }

  return {
    hits: hits.sort(bySizeDescending),
    stats: {
      records: visited,
      readMs: sizeStart - started,
      indexMs: 0,
      sizeMs: clock() - sizeStart,
    },
  };
}

function* chunk(items, size) {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Total a subtree.
 *
 * A node_modules tree is tens of thousands of small files, and one awaited
 * stat per file is what makes a naive scan slow. Two things keep this quick:
 * directories are read a level at a time so sibling reads overlap, and the
 * stats for one directory's files are issued together rather than serially.
 */
async function measureSubtree(root, signal) {
  let bytes = 0n;
  let files = 0;
  let mtime = null;

  try {
    mtime = Math.floor((await fsp.stat(root)).mtimeMs);
  } catch {
    /* keep null */
  }

  let level = [root];

  while (level.length > 0) {
    signal?.throwIfAborted();
    const reads = await Promise.all(level.map(readDirSafe));
    const next = [];
    const statJobs = [];

    for (const { dir, entries } of reads) {
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          next.push(full);
        } else if (entry.isFile()) {
          statJobs.push(sizeOf(full));
        }
      }
    }

    for (const size of await Promise.all(statJobs)) {
      if (size === null) continue;
      bytes += size;
      files += 1;
    }

    level = next;
  }

  return { path: root, bytes: bytes.toString(), files, mtime };
}

async function readDirSafe(dir) {
  try {
    return { dir, entries: await fsp.readdir(dir, { withFileTypes: true }) };
  } catch {
    return { dir, entries: [] };
  }
}

async function sizeOf(file) {
  try {
    return BigInt((await fsp.stat(file)).size);
  } catch {
    return null; // vanished mid-scan
  }
}

// ---------------------------------------------------------------------------

function bySizeDescending(a, b) {
  return Number(BigInt(b.bytes) - BigInt(a.bytes));
}

function driveLetterOf(root) {
  const match = /^([A-Za-z]:)/.exec(path.resolve(root));
  return match ? match[1].toUpperCase() : null;
}

function normalize(p) {
  return path.resolve(p).toLowerCase().replace(/\\+$/, "");
}
