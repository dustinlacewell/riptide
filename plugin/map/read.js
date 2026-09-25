/**
 * Read one drive for the space map: the I/O around compact.js.
 *
 *   read      the drive's MFT, through the injected readTree
 *   compact   the tree into a snapshot; the tree is dropped after
 *   publish   into the store, only once everything above has finished
 *
 * A stopped read throws the signal's reason and publishes nothing, so the
 * store keeps whatever snapshot it held before.
 */

import fsp from "node:fs/promises";

import { readVolumeTree } from "../mft/scan.js";
import { buildSnapshot } from "./compact.js";
import { idOfPath } from "./page.js";

const now = () => performance.now();

/**
 * @param {{drive: string, root?: string|null, store: object,
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
  readTree = readVolumeTree,
  usedSpace = volumeUsed,
  onProgress = () => {},
  signal,
  clock = now,
}) {
  const run = store.begin(drive, signal);
  try {
    return await readAndPublish({ drive, root, store, readTree, usedSpace, onProgress, clock }, run.signal);
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

// ---------------------------------------------------------------------------

async function readAndPublish({ drive, root, store, readTree, usedSpace, onProgress, clock }, signal) {
  signal.throwIfAborted();
  const started = clock();
  const volume = await readTree(drive, { onProgress, signal });
  signal.throwIfAborted();

  const compactStart = clock();
  onProgress({ stage: "compact" });
  const snap = buildSnapshot(volume);
  const compactMs = clock() - compactStart;

  const used = await usedSpace(drive);
  signal.throwIfAborted();

  const slot = store.publish(drive, snap, { recordsTotal: volume.recordsTotal });
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
      compactMs,
      totalMs: clock() - started,
      folders: snap.count,
      rootBytes: snap.bytes[0],
      volumeUsed: used,
      unreachable: snap.unreachable?.count ?? 0,
    },
  };
}
