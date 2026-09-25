/**
 * Test helper: a tree as plain, comparable data.
 *
 * Two trees fold the same records exactly when their dumps are deepEqual:
 * folders, every folder's own tallies, every mark count and every file row.
 */

import { fileAt } from "./files.js";

/**
 * @param {object} tree from fold.js
 * @param {number} span record numbers to look at, 0..span-1
 */
export function dumpTree(tree, span) {
  const sorted = (map, value = (v) => v) =>
    [...map].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, value(v)]);

  const marks = [];
  for (let dir = 0; dir < span; dir++) {
    for (const id of tree.marks.ids) {
      const count = tree.marks.count(dir, id);
      if (count > 0) marks.push([dir, id, count]);
    }
  }

  const files = [];
  for (let n = 0; n < span; n++) {
    const file = fileAt(tree.files, n);
    if (file) files.push([n, file]);
  }

  return {
    dirs: sorted(tree.dirs, ({ name, parent, seq, mtime }) => ({ name, parent, seq, mtime })),
    ownBytes: sorted(tree.ownBytes, String),
    ownFiles: sorted(tree.ownFiles),
    ownLatest: sorted(tree.ownLatest),
    marks,
    files,
  };
}
