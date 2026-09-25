/**
 * Read views of a map snapshot: one node's children, a node's path, and the
 * node at a path.
 *
 * A page holds the largest `limit` children of a node, and, when depth > 1,
 * each child's own page nested as `kids`. The rest of the children fold into
 * one "other" bucket, so a page stays small whatever the folder holds.
 *
 * Pure: reads the snapshot, changes nothing.
 */

import { screenPaths } from "../zap.js";
import { REFUSED, REMOVED, SYNTHETIC, junkKind } from "./flags.js";

const MAX_DEPTH = 3;
const MAX_LIMIT = 200;

/**
 * @param {object} snap
 * @param {number} id
 * @param {{depth?: number, limit?: number}} [opts]
 * @returns {{node: object, children: object[], other: {count: number, bytes: number},
 *            ownFiles: {bytes: number, count: number}}|null} null for an unknown id
 */
export function childrenPage(snap, id, { depth = 2, limit = 40 } = {}) {
  if (!validId(snap, id) || snap.flags[id] & REMOVED) return null;
  const d = clamp(depth, 1, MAX_DEPTH);
  const l = clamp(limit, 1, MAX_LIMIT);
  return { node: describe(snap, id), trail: trailOf(snap, id), ...listing(snap, id, d, l) };
}

/**
 * The node's ancestors from the drive root down, the node last.
 *
 * @returns {Array<{id: number, name: string}>}
 */
export function trailOf(snap, id) {
  const out = [];
  for (let a = id; a >= 0; a = snap.parentId[a]) out.push({ id: a, name: snap.names[a] });
  return out.reverse();
}

/**
 * The full path of a node, or null for a node under the synthetic
 * "(unreachable)" bucket — it has no real path.
 *
 * @param {object} snap
 * @param {number} id
 * @returns {string|null}
 */
export function pathOf(snap, id) {
  if (!validId(snap, id)) return null;
  const parts = [];
  for (let a = id; a > 0; a = snap.parentId[a]) {
    if (snap.flags[a] & SYNTHETIC) return null;
    parts.push(snap.names[a]);
  }
  parts.reverse();
  return snap.names[0] + parts.join("\\");
}

/**
 * The id of the node at a path, or -1. Case-insensitive, like the volume.
 *
 * @param {object} snap
 * @param {string} full an absolute Windows path on the snapshot's drive
 * @returns {number}
 */
export function idOfPath(snap, full) {
  const text = String(full).replace(/\//g, "\\");
  const root = snap.names[0].toLowerCase();
  const lower = text.toLowerCase();
  if (!lower.startsWith(root.replace(/\\$/, ""))) return -1;

  const rest = text.slice(root.length).split("\\").filter(Boolean);
  let id = 0;
  for (const part of rest) {
    id = childNamed(snap, id, part.toLowerCase());
    if (id < 0) return -1;
  }
  return snap.flags[id] & REMOVED ? -1 : id;
}

// ---------------------------------------------------------------------------

function listing(snap, id, depth, limit) {
  const children = [];
  let otherCount = 0;
  let otherBytes = 0;

  for (let k = snap.childStart[id]; k < snap.childStart[id + 1]; k++) {
    const child = snap.childList[k];
    if (snap.flags[child] & REMOVED) continue;
    if (children.length < limit) {
      const row = describe(snap, child);
      if (depth > 1) row.kids = listing(snap, child, depth - 1, limit);
      children.push(row);
    } else {
      otherCount += 1;
      otherBytes += snap.bytes[child];
    }
  }

  return {
    children,
    other: { count: otherCount, bytes: otherBytes },
    ownFiles: { bytes: snap.ownBytes[id], count: snap.ownFiles[id] },
  };
}

function describe(snap, id) {
  const flags = snap.flags[id];
  const full = pathOf(snap, id);
  const row = {
    id,
    recNo: snap.recNo[id],
    name: snap.names[id],
    bytes: snap.bytes[id],
    files: snap.files[id],
    junk: junkKind(flags),
    junkBytes: snap.junkBytes[id],
    hasKids: snap.childStart[id + 1] > snap.childStart[id],
  };
  const label = snap.labels.get(id);
  if (label) row.label = label;
  const locked = lockOf(flags, full);
  if (locked) row.locked = locked;
  return row;
}

/**
 * Why a node cannot be picked for deletion, or null. The server checks
 * again at offer time; this is what lets the map show it up front.
 */
function lockOf(flags, full) {
  if (flags & SYNTHETIC || full === null) return "not a real folder";
  const { refused } = screenPaths([full]);
  if (refused.length > 0) return refused[0].reason;
  if (flags & REFUSED) return "refused by a cache rule";
  return null;
}

function childNamed(snap, id, lowerName) {
  for (let k = snap.childStart[id]; k < snap.childStart[id + 1]; k++) {
    const child = snap.childList[k];
    if (snap.names[child].toLowerCase() === lowerName) return child;
  }
  return -1;
}

function validId(snap, id) {
  return Number.isInteger(id) && id >= 0 && id < snap.count;
}

function clamp(value, lo, hi) {
  const n = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : lo;
  return Math.min(hi, Math.max(lo, n));
}
