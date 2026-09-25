/**
 * Read one drive for the space map: the I/O around compact.js.
 *
 *   read      the drive's MFT, through the injected readTree
 *   junk      mark cache hits and name hits (junk.js)
 *   compact   the tree into a snapshot; the tree is dropped after
 *   publish   into the store, only once everything above has finished
 *
 * A stopped read throws the signal's reason and publishes nothing, so the
 * store keeps whatever snapshot it held before.
 */

import fsp from "node:fs/promises";

import { readVolumeTree } from "../mft/scan.js";
import { buildNameQuery } from "../mft/filenames.js";
import { collectNeeds } from "../caches/needs.js";
import { buildSnapshot } from "./compact.js";
import { junkMarks } from "./junk.js";
import { idOfPath } from "./page.js";

const now = () => performance.now();

/**
 * @param {{drive: string, root?: string|null, store: object,
 *          entries?: object[], patterns?: string[], drives?: string[], env?: object,
 *          readTree?: typeof readVolumeTree,
 *          usedSpace?: (drive: string) => Promise<number|null>,
 *          onProgress?: (n: object) => void, signal?: AbortSignal,
 *          clock?: () => number}} opts
 * @returns {Promise<{drive: string, gen: number, readAt: number, rootId: number,
 *                    stats: object}>}
 */
export async function readMap({
  drive,
  root = null,
  store,
  entries = [],
  patterns = [],
  drives = [],
  env = process.env,
  readTree = readVolumeTree,
  usedSpace = volumeUsed,
  onProgress = () => {},
  signal,
  clock = now,
}) {
  const run = store.begin(drive, signal);
  const opts = { drive, root, store, entries, patterns, drives, env };
  try {
    return await readAndPublish({ ...opts, readTree, usedSpace, onProgress, clock }, run.signal);
  } finally {
    run.end();
  }
}

/**
 * Space the volume reports as used, in bytes, or null when it cannot say.
 * The MFT gives logical file sizes, so this is what shows the gap.
 */
export async function volumeUsed(drive) {
  try {
    const s = await fsp.statfs(`${drive}\\`);
    return (s.blocks - s.bfree) * s.bsize;
  } catch {
    return null;
  }
}

/**
 * Build a held snapshot again from its drive's tree after the tree moved
 * on (the change journal updated it). Patching the snapshot in place
 * would mean inserting and moving rows in its breadth-first layout; a
 * rebuild is one junk pass and one compact, a few hundred ms for a large
 * drive. The rebuild takes new ids, so a client viewing it is told the map
 * changed and starts again at the drive root.
 *
 * @param {{drive: string, tree: object|null, store: object}} opts
 * @returns {object|null} the new slot; null when there was nothing to do
 */
export function rebuildMap({ drive, tree, store }) {
  const slot = store.peek(drive);
  if (!slot || !tree || slot.version === null || slot.version === tree.version) return null;
  const junk = junkMarks(tree, slot.context ?? {});
  const snap = buildSnapshot(tree, { junk });
  return store.publish(drive, snap, {
    recordsTotal: tree.recordsTotal,
    version: tree.version,
    context: slot.context,
  });
}

// ---------------------------------------------------------------------------

/** What junkMarks needs, kept with the snapshot for a rebuild. */
function junkContext({ entries, patterns, drives, env }) {
  return { entries, patterns, drives, env };
}

async function readAndPublish(opts, signal) {
  const { drive, root, store, readTree, usedSpace, onProgress, clock } = opts;
  signal.throwIfAborted();
  const started = clock();
  // The cache filters ask about files (a Cargo.toml beside a target), and
  // files are dropped as the MFT streams; the query keeps what they need.
  const query = buildNameQuery(collectNeeds(opts.entries));
  const used = await usedSpace(drive);
  signal.throwIfAborted();
  // The last await. From the tree to the publish nothing yields, so the
  // snapshot carries the version of the tree it was built from and no
  // newer rebuild can land in between (rebuildMap).
  const volume = await readTree(drive, { query, onProgress, signal });
  signal.throwIfAborted();

  const junkStart = clock();
  onProgress({ stage: "junk" });
  const junk = junkMarks(volume, opts);
  const junkMs = clock() - junkStart;
  signal.throwIfAborted();

  const compactStart = clock();
  onProgress({ stage: "compact" });
  const snap = buildSnapshot(volume, { junk });
  const compactMs = clock() - compactStart;

  const slot = store.publish(drive, snap, {
    recordsTotal: volume.recordsTotal,
    version: volume.version ?? null,
    context: junkContext(opts),
  });
  const rootId = root ? Math.max(0, idOfPath(snap, root)) : 0;

  return {
    drive: slot.drive,
    gen: slot.gen,
    read: slot.read,
    readAt: slot.readAt,
    rootId,
    stats: {
      records: volume.recordsDone,
      readMs: volume.readMs,
      how: volume.how ?? "full",
      changes: volume.changes ?? 0,
      junkMs,
      compactMs,
      junkBytes: snap.junkBytes[0],
      totalMs: clock() - started,
      folders: snap.count,
      rootBytes: snap.bytes[0],
      volumeUsed: used,
      unreachable: snap.unreachable?.count ?? 0,
    },
  };
}
