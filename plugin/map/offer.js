/**
 * Turn folders picked on the space map into paths the server will offer
 * for deletion.
 *
 *   resolve   record numbers to snapshot nodes; unknown, deleted and
 *             synthetic nodes are refused
 *   nest      a pick inside another pick is dropped: the outer one covers it
 *   screen    protected paths, system subtrees and the depth rule — the map
 *             never waives depth: any folder on the drive can be picked, so
 *             nothing vouches for one at the drive root
 *
 * Pure: reads the snapshot, changes nothing.
 */

import { screenPaths } from "../zap.js";
import { REFUSED, REMOVED, SYNTHETIC } from "./flags.js";
import { pathOf } from "./page.js";

/**
 * @param {object} snap
 * @param {unknown[]} recNos as the client sent them
 * @returns {{paths: string[], items: Array<{path: string, bytes: string, recNo: number}>,
 *            bytes: string, refused: Array<{path: string, reason: string}>}}
 */
export function offerPicks(snap, recNos) {
  const refused = [];
  const ids = resolve(snap, recNos, refused);
  const outer = dropNested(snap, ids);
  return screen(snap, outer, refused);
}

// ---------------------------------------------------------------------------

function resolve(snap, recNos, refused) {
  const ids = new Set();
  for (const raw of recNos) {
    const recNo = Number(raw);
    const id =
      Number.isInteger(recNo) && recNo >= 0 && recNo < snap.recToId.length
        ? snap.recToId[recNo]
        : -1;
    const why = reasonAgainst(snap, id);
    if (why) {
      refused.push({ path: id > 0 ? (pathOf(snap, id) ?? snap.names[id]) : `record ${String(raw)}`, reason: why });
    } else {
      ids.add(id);
    }
  }
  return ids;
}

function reasonAgainst(snap, id) {
  if (id < 0) return "not in the map";
  if (id === 0) return "protected system path";
  if (removedOrUnder(snap, id)) return "already deleted";
  if (snap.flags[id] & SYNTHETIC || pathOf(snap, id) === null) return "not a real folder";
  if (snap.flags[id] & REFUSED) return "refused by a cache rule";
  return null;
}

function removedOrUnder(snap, id) {
  for (let a = id; a >= 0; a = snap.parentId[a]) {
    if (snap.flags[a] & REMOVED) return true;
  }
  return false;
}

function dropNested(snap, ids) {
  const out = [];
  for (const id of ids) {
    let covered = false;
    for (let a = snap.parentId[id]; a >= 0 && !covered; a = snap.parentId[a]) {
      covered = ids.has(a);
    }
    if (!covered) out.push(id);
  }
  return out;
}

function screen(snap, ids, refused) {
  const byPath = new Map(ids.map((id) => [pathOf(snap, id), id]));
  const screened = screenPaths([...byPath.keys()]);
  const items = [];
  let total = 0;

  for (const full of screened.allowed) {
    const id = byPath.get(full);
    items.push({ path: full, bytes: String(snap.bytes[id]), recNo: snap.recNo[id] });
    total += snap.bytes[id];
  }

  return {
    paths: items.map((i) => i.path),
    items,
    bytes: String(total),
    refused: [...refused, ...screened.refused],
  };
}
