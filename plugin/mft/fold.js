/**
 * The volume tree as a fold over MFT records.
 *
 * A tree is a pure function of the records it was given: directories by
 * record number, and each folder's own tallies of the files directly in
 * it. addRecord folds one record in; the stream calls it for every record
 * of a full read. removeRecord takes a record's contribution back out,
 * from what the tree stored, so a change is: remove, then add the record
 * as it is now. Both are safe to repeat.
 *
 *   dirs       Map  record -> directory record
 *   ownBytes   Map  folder -> bytes of the files directly in it (bigint)
 *   ownFiles   Map  folder -> count of those files
 *   ownLatest  Map  folder -> newest of their modified times, Unix ms at
 *                   whole seconds; a folder with no dated file has none
 *   marks      counted file-name marks (filenames.js)
 *   files      what each file record added (files.js)
 *   journalRecord  record number of $Extend\$UsnJrnl, or null
 *
 * No I/O. The tree is updated in place.
 */

import { createMarks, markFile, queryIds } from "./filenames.js";
import { NO_PARENT, createFileTable, dropFile, fileAt, putFile, toSeconds } from "./files.js";

// $Extend is always record 11; the change journal is the file in it named
// $UsnJrnl. Spotting it as it streams past saves reading $Extend's index.
const EXTEND_RECORD = 11;
const JOURNAL_NAME = "$UsnJrnl";

// A pattern's bit in a file's match mask. Arithmetic rather than bit
// operators, so the mask holds up to 53 patterns rather than 31.
const MAX_PATTERNS = 53;

/**
 * @param {{size?: number, query?: {exact: Set<string>, ext: Set<string>}|null}} [opts]
 *   size is the record count, to reserve the arrays up front
 */
export function createTree({ size = 0, query = null } = {}) {
  const ids = queryIds(query);
  if (ids.length > MAX_PATTERNS) {
    throw new Error(`too many file patterns: ${ids.length}, at most ${MAX_PATTERNS}`);
  }
  return {
    dirs: new Map(),
    ownBytes: new Map(),
    ownFiles: new Map(),
    ownLatest: new Map(),
    marks: createMarks(ids, size),
    query,
    files: createFileTable(size),
    journalRecord: null,
  };
}

/**
 * Fold one parsed record into the tree.
 *
 * @param {ReturnType<typeof createTree>} tree
 * @param {number} n record number
 * @param {{isDirectory: boolean, name: string, parent: number, size: bigint,
 *          mtime: number|null, seq: number}} entry from parseFileRecord
 */
export function addRecord(tree, n, entry) {
  if (entry.isDirectory) {
    tree.dirs.set(n, entry);
    return;
  }
  if (entry.parent === EXTEND_RECORD && entry.name === JOURNAL_NAME) tree.journalRecord = n;

  const parent = entry.parent;
  const seconds = toSeconds(entry.mtime);
  tree.ownBytes.set(parent, (tree.ownBytes.get(parent) ?? 0n) + entry.size);
  tree.ownFiles.set(parent, (tree.ownFiles.get(parent) ?? 0) + 1);
  if (seconds > 0) foldLatest(tree.ownLatest, parent, seconds * 1000);

  const ids = tree.query ? markFile(tree.marks, tree.query, entry.name, parent) : [];
  putFile(tree.files, n, {
    parent,
    size: Number(entry.size),
    mtime: seconds,
    seq: entry.seq ?? 0,
    mask: maskOf(tree.marks.ids, ids),
  });
}

/**
 * Take a record's contribution back out: a folder leaves dirs; a file
 * leaves its parent's tallies and marks. A record that added nothing is
 * left alone.
 *
 * A folder whose newest file time may have left with the file is put in
 * `stale`; refreshLatest settles those once a batch is done.
 *
 * @param {ReturnType<typeof createTree>} tree
 * @param {number} n
 * @param {Set<number>} stale folders whose ownLatest must be recomputed
 * @returns {number|null} the folder whose tallies changed, or the folder
 *   removed; null when the record added nothing
 */
export function removeRecord(tree, n, stale) {
  if (tree.dirs.delete(n)) return n;
  const file = fileAt(tree.files, n);
  if (!file) return null;

  const { parent, size, mtime, mask } = file;
  const files = (tree.ownFiles.get(parent) ?? 1) - 1;
  if (files <= 0) {
    tree.ownFiles.delete(parent);
    tree.ownBytes.delete(parent);
    tree.ownLatest.delete(parent);
  } else {
    tree.ownFiles.set(parent, files);
    tree.ownBytes.set(parent, (tree.ownBytes.get(parent) ?? 0n) - BigInt(size));
    if (mtime > 0 && mtime * 1000 >= (tree.ownLatest.get(parent) ?? 0)) stale.add(parent);
  }
  for (const id of idsOfMask(tree.marks.ids, mask)) tree.marks.unset(parent, id);
  dropFile(tree.files, n);
  return parent;
}

/**
 * Recompute ownLatest for folders that lost their newest file. One pass
 * over the file table, and only when there is something to settle.
 *
 * @param {ReturnType<typeof createTree>} tree
 * @param {Set<number>} stale
 */
export function refreshLatest(tree, stale) {
  if (stale.size === 0) return;
  let top = 0;
  for (const dir of stale) if (dir > top) top = dir;
  const wanted = new Uint8Array(top + 1);
  for (const dir of stale) wanted[dir] = 1;

  const newest = new Map();
  const { parent, mtime } = tree.files;
  for (let n = 0; n < parent.length; n++) {
    const p = parent[n];
    if (p === NO_PARENT || p >= wanted.length || wanted[p] === 0 || mtime[n] === 0) continue;
    const ms = mtime[n] * 1000;
    if (!(newest.get(p) >= ms)) newest.set(p, ms);
  }
  for (const dir of stale) {
    if (newest.has(dir)) tree.ownLatest.set(dir, newest.get(dir));
    else tree.ownLatest.delete(dir);
  }
}

/**
 * The pattern ids a match mask stands for.
 *
 * @param {string[]} ids the marks' ids, in order
 * @param {number} mask
 */
export function idsOfMask(ids, mask) {
  const out = [];
  for (let i = 0; i < ids.length && mask > 0; i++) {
    const bit = 2 ** i;
    if (Math.floor(mask / bit) % 2 === 1) out.push(ids[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------

function maskOf(allIds, matched) {
  let mask = 0;
  for (const id of matched) mask += 2 ** allIds.indexOf(id);
  return mask;
}

/**
 * Keep the newest file modified time seen in a folder. Only files count:
 * a folder's own time moves whenever an entry is added or removed —
 * including by this tool's own deletes — so it says nothing about work.
 */
function foldLatest(ownLatest, parent, ms) {
  const held = ownLatest.get(parent);
  if (held === undefined || ms > held) ownLatest.set(parent, ms);
}
