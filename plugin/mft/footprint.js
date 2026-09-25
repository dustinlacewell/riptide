/**
 * About how much memory one kept drive costs: its tree and its space-map
 * snapshot. Shown next to the "drives kept ready" setting.
 *
 * Typed arrays are counted exactly. Objects and Map entries use per-item
 * costs measured on a synthetic 4.87M-record volume (see the report in the
 * commit that set them); they move with V8, so the figure is an estimate.
 *
 * Pure.
 */

import { tableBytes } from "./files.js";

// One directory record object, its name string and its Map entry.
const DIR_BYTES = 165;
// One entry in ownBytes (a bigint value), ownFiles or ownLatest.
const TALLY_BYTES = 50;
// One space-map row across the snapshot's typed arrays and names list,
// with its name string.
const SNAPSHOT_ROW_BYTES = 76;
// The snapshot's record -> row index.
const SNAPSHOT_RECORD_BYTES = 4;

/**
 * @param {{dirs: Map, ownBytes: Map, files: object, marks: {bytes: number},
 *          recordsTotal?: number}} tree
 * @returns {number} bytes
 */
export function driveBytes(tree) {
  const records = Math.max(tree.recordsTotal ?? 0, tree.files.parent.length);
  const treeBytes =
    tableBytes(tree.files) +
    tree.dirs.size * DIR_BYTES +
    tree.ownBytes.size * TALLY_BYTES * 3 +
    tree.marks.bytes;
  const snapshot = tree.dirs.size * SNAPSHOT_ROW_BYTES + records * SNAPSHOT_RECORD_BYTES;
  return treeBytes + snapshot;
}
