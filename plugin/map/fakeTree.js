/**
 * Test helper: a fake volume tree in the shape readVolumeTree returns.
 *
 * `folders` maps a path under the root ("a\\b") to the bytes of one file
 * directly inside it. Zero bytes means no file. Parents are created as
 * needed. byPath maps each path back to its record number.
 */

import { ROOT_RECORD } from "../mft/tree.js";

/**
 * @param {Record<string, number>} folders
 * @param {{drive?: string}} [opts]
 */
export function fakeTree(folders, { drive = "C:" } = {}) {
  const dirs = new Map([
    [ROOT_RECORD, { recordNumber: ROOT_RECORD, parent: ROOT_RECORD, name: ".", isDirectory: true }],
  ]);
  const byPath = new Map([["", ROOT_RECORD]]);
  const ownBytes = new Map();
  const ownFiles = new Map();
  let next = 100;

  const ensure = (full) => {
    if (byPath.has(full)) return byPath.get(full);
    const cut = full.lastIndexOf("\\");
    const parent = ensure(cut < 0 ? "" : full.slice(0, cut));
    const number = next++;
    byPath.set(full, number);
    dirs.set(number, { recordNumber: number, parent, name: full.slice(cut + 1), isDirectory: true });
    return number;
  };

  for (const [full, bytes] of Object.entries(folders)) {
    const number = ensure(full);
    if (bytes > 0) {
      ownBytes.set(number, BigInt(bytes));
      ownFiles.set(number, 1);
    }
  }

  return {
    tree: { dirs, ownBytes, ownFiles, marks: new Map(), drive, recordsTotal: next },
    byPath,
  };
}
