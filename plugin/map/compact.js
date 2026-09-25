/**
 * Compact a volume's directory tree into a dense snapshot for the space map.
 *
 * The tree from readVolumeTree is a Map of record objects keyed by MFT
 * record number. That shape is fine for one scan and too heavy to keep
 * between requests. The snapshot keeps one row per folder in typed arrays,
 * indexed by a dense id:
 *
 *   parentId   Int32    the parent's id; -1 for the root
 *   recNo      Int32    the MFT record number; -1 for a synthetic node
 *   bytes      Float64  logical size of everything beneath, own files too
 *   ownBytes   Float64  logical size of the files directly in the folder
 *   junkBytes  Float64  the part of bytes that junk folders hold
 *   cautionBytes Float64 the part of junkBytes in caution caches
 *   files      Uint32   file count beneath
 *   ownFiles   Uint32   files directly in the folder
 *   flags      Uint8    see flags.js
 *
 * Children are stored as CSR: the children of id are
 * childList[childStart[id] .. childStart[id + 1]), sorted by bytes, largest
 * first. recToId maps a record number back to its id (-1 when absent).
 *
 * Ids follow breadth-first order, so a parent's id is always below its
 * children's. One pass from the highest id down therefore rolls every
 * total up in a single sweep.
 *
 * Folders whose parent chain never reaches the root (a deleted parent, a
 * torn record, a cycle) are gathered under one "(unreachable)" node. Files
 * whose parent folder is unknown land there too.
 *
 * Pure: a function of the tree it is given.
 */

import { ROOT_RECORD } from "../mft/tree.js";
import { CACHE_CAUTION, REMOVED, SYNTHETIC, isJunk } from "./flags.js";

export const UNREACHABLE_NAME = "(unreachable)";

/**
 * @param {{dirs: Map<number, {recordNumber: number, parent: number, name: string}>,
 *          ownBytes: Map<number, bigint|number>, ownFiles: Map<number, number>,
 *          drive: string, recordsTotal?: number}} tree
 * @param {{junk?: Map<number, {flags: number, label?: string}>|null}} [opts]
 *   junk marks by record number (see junk.js)
 * @returns {object} the snapshot
 */
export function buildSnapshot(tree, { junk = null } = {}) {
  const dirs = [...tree.dirs.values()];
  const span = recordSpan(tree, dirs);
  const index = indexByRecord(dirs, span);
  const byParent = groupByParent(dirs, index);
  const layout = orderNodes(tree, dirs, index, byParent);

  const snap = allocate(layout.count, span);
  fillRows(snap, tree, dirs, layout, junk);
  rollUp(snap);
  buildChildren(snap);

  snap.drive = tree.drive;
  snap.unreachable = layout.unreachable;
  snap.gen = 0;
  return snap;
}

/**
 * Take deleted folders out of the totals.
 *
 * Each removed node's bytes, files and junk bytes are subtracted from every
 * ancestor, and the node is marked REMOVED so pages skip it. A folder whose
 * ancestor is already removed is skipped: its bytes left with the ancestor.
 *
 * @param {object} snap modified in place
 * @param {{removed: number[], gen?: number}} change record numbers; gen is
 *        the new generation (default: one past the current)
 * @returns {number} how many nodes were removed
 */
export function applyChanges(snap, { removed, gen = snap.gen + 1 }) {
  let count = 0;
  for (const recNo of removed) {
    const id = recNo >= 0 && recNo < snap.recToId.length ? snap.recToId[recNo] : -1;
    if (id <= 0 || removedAlready(snap, id)) continue;
    subtractFromAncestors(snap, id);
    snap.flags[id] |= REMOVED;
    count += 1;
  }
  snap.gen = gen;
  return count;
}

// ---------------------------------------------------------------------------
// Build steps

function recordSpan(tree, dirs) {
  let max = tree.recordsTotal ?? 0;
  for (const rec of dirs) if (rec.recordNumber + 1 > max) max = rec.recordNumber + 1;
  for (const key of tree.ownBytes.keys()) if (key + 1 > max) max = key + 1;
  return Math.max(max, ROOT_RECORD + 1);
}

// record number -> position in dirs, -1 when the record is not a folder
function indexByRecord(dirs, span) {
  const index = new Int32Array(span).fill(-1);
  dirs.forEach((rec, i) => {
    index[rec.recordNumber] = i;
  });
  return index;
}

// CSR over dirs positions. The root is its own parent and is left out.
function groupByParent(dirs, index) {
  const count = new Int32Array(dirs.length + 1);
  const parentAt = new Int32Array(dirs.length).fill(-1);

  dirs.forEach((rec, i) => {
    if (rec.parent === rec.recordNumber) return;
    const p = rec.parent >= 0 && rec.parent < index.length ? index[rec.parent] : -1;
    parentAt[i] = p;
    if (p >= 0) count[p + 1] += 1;
  });

  for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
  const start = count.slice();
  const list = new Int32Array(start[dirs.length]);
  const fill = start.slice(0, dirs.length);
  parentAt.forEach((p, i) => {
    if (p >= 0) list[fill[p]++] = i;
  });

  return { start, list, parentAt };
}

/**
 * Assign ids breadth-first from the root, then gather what the root cannot
 * reach under the "(unreachable)" node. A visited set guards every walk, so
 * a cycle ends the walk instead of looping.
 */
function orderNodes(tree, dirs, index, byParent) {
  const rootAt = index[ROOT_RECORD];
  const dirOf = new Int32Array(dirs.length + 2).fill(-1);
  const parentOf = new Int32Array(dirs.length + 2).fill(-1);
  const seen = new Uint8Array(dirs.length);
  let next = 0;

  const visit = (start, parentId) => {
    const queue = [start];
    seen[start] = 1;
    dirOf[next] = start;
    parentOf[next] = parentId;
    const ids = [next++];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      const id = ids[head];
      for (let k = byParent.start[at]; k < byParent.start[at + 1]; k++) {
        const child = byParent.list[k];
        if (seen[child]) continue;
        seen[child] = 1;
        queue.push(child);
        dirOf[next] = child;
        parentOf[next] = id;
        ids.push(next++);
      }
    }
  };

  // The root row exists even when the tree has no record 5.
  if (rootAt >= 0) visit(rootAt, -1);
  else parentOf[next++] = -1;

  const heads = [];
  dirs.forEach((_, i) => {
    if (!seen[i] && byParent.parentAt[i] < 0) heads.push(i);
  });
  const looseFiles = [...tree.ownBytes.keys()].some(
    (recNo) => recNo < 0 || recNo >= index.length || index[recNo] < 0,
  );
  const anyUnseen = heads.length > 0 || seen.some((s, i) => !s && i !== rootAt);

  let unreachable = null;
  if (anyUnseen || looseFiles) {
    const id = next++;
    parentOf[id] = 0;
    let attached = 0;
    for (const at of heads) {
      if (seen[at]) continue;
      visit(at, id);
      attached += 1;
    }
    // Whatever is still unseen hangs off a cycle; break it anywhere.
    for (let i = 0; i < dirs.length; i++) {
      if (seen[i]) continue;
      visit(i, id);
      attached += 1;
    }
    unreachable = { id, count: attached };
  }

  return { count: next, dirOf, parentOf, rootAt, unreachable };
}

function allocate(n, span) {
  return {
    count: n,
    parentId: new Int32Array(n),
    recNo: new Int32Array(n),
    bytes: new Float64Array(n),
    ownBytes: new Float64Array(n),
    junkBytes: new Float64Array(n),
    cautionBytes: new Float64Array(n),
    files: new Uint32Array(n),
    ownFiles: new Uint32Array(n),
    flags: new Uint8Array(n),
    names: new Array(n),
    labels: new Map(),
    childStart: new Int32Array(n + 1),
    childList: new Int32Array(Math.max(n - 1, 0)),
    recToId: new Int32Array(span).fill(-1),
  };
}

function fillRows(snap, tree, dirs, layout, junk) {
  const { dirOf, parentOf } = layout;
  const unreachableId = layout.unreachable?.id ?? -1;

  for (let id = 0; id < snap.count; id++) {
    snap.parentId[id] = parentOf[id];
    const at = dirOf[id];

    if (at < 0) {
      snap.recNo[id] = id === 0 ? ROOT_RECORD : -1;
      snap.names[id] = id === 0 ? rootName(tree.drive) : UNREACHABLE_NAME;
      if (id !== 0) snap.flags[id] = SYNTHETIC;
      continue;
    }

    const rec = dirs[at];
    snap.recNo[id] = rec.recordNumber;
    snap.recToId[rec.recordNumber] = id;
    snap.names[id] = id === 0 ? rootName(tree.drive) : rec.name;

    const mark = junk?.get(rec.recordNumber);
    if (mark) {
      snap.flags[id] = mark.flags;
      if (mark.label) snap.labels.set(id, mark.label);
    }
  }
  if (snap.count > 0 && snap.recNo[0] === ROOT_RECORD) snap.recToId[ROOT_RECORD] = 0;

  for (const [recNo, value] of tree.ownBytes) {
    const known = recNo >= 0 && recNo < snap.recToId.length ? snap.recToId[recNo] : -1;
    const id = known >= 0 ? known : unreachableId;
    if (id < 0) continue;
    snap.ownBytes[id] += Number(value);
    snap.ownFiles[id] += tree.ownFiles.get(recNo) ?? 0;
  }
}

// Highest id first: every child is finished before its parent is read.
function rollUp(snap) {
  snap.bytes.set(snap.ownBytes);
  snap.files.set(snap.ownFiles);
  for (let id = snap.count - 1; id >= 0; id--) {
    const flags = snap.flags[id];
    // The outermost junk folder decides: all its bytes are junk, of its kind.
    if (isJunk(flags)) {
      snap.junkBytes[id] = snap.bytes[id];
      snap.cautionBytes[id] = flags & CACHE_CAUTION ? snap.bytes[id] : 0;
    }
    const p = snap.parentId[id];
    if (p < 0) continue;
    snap.bytes[p] += snap.bytes[id];
    snap.files[p] += snap.files[id];
    snap.junkBytes[p] += snap.junkBytes[id];
    snap.cautionBytes[p] += snap.cautionBytes[id];
  }
}

function buildChildren(snap) {
  const { childStart, childList, parentId } = snap;
  for (let id = 1; id < snap.count; id++) childStart[parentId[id] + 1] += 1;
  for (let i = 1; i <= snap.count; i++) childStart[i] += childStart[i - 1];
  const fill = childStart.slice(0, snap.count);
  for (let id = 1; id < snap.count; id++) childList[fill[parentId[id]]++] = id;
  for (let id = 0; id < snap.count; id++) sortChildren(snap, id);
}

// ---------------------------------------------------------------------------
// Change steps

function removedAlready(snap, id) {
  for (let a = id; a >= 0; a = snap.parentId[a]) {
    if (snap.flags[a] & REMOVED) return true;
  }
  return false;
}

function subtractFromAncestors(snap, id) {
  const bytes = snap.bytes[id];
  const files = snap.files[id];
  let junk = snap.junkBytes[id];
  let caution = snap.cautionBytes[id];

  for (let a = snap.parentId[id]; a >= 0; a = snap.parentId[a]) {
    snap.bytes[a] -= bytes;
    snap.files[a] -= files;
    // A junk folder counts all its bytes as junk of its own kind, so its
    // ancestors lose everything that left it, as that kind.
    const flags = snap.flags[a];
    if (isJunk(flags)) {
      junk = bytes;
      caution = flags & CACHE_CAUTION ? bytes : 0;
    }
    snap.junkBytes[a] -= junk;
    snap.cautionBytes[a] -= caution;
    sortChildren(snap, a);
  }
}

function sortChildren(snap, id) {
  const from = snap.childStart[id];
  const to = snap.childStart[id + 1];
  if (to - from < 2) return;
  const range = snap.childList.subarray(from, to);
  const sorted = Array.from(range).sort((a, b) => snap.bytes[b] - snap.bytes[a]);
  range.set(sorted);
}

function rootName(drive) {
  return drive ? `${drive}\\` : "\\";
}
