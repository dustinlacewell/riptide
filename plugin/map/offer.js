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
 *   identify  the folder on disk must still be the one the map read: a
 *             folder renamed or recreated since keeps the path, not the
 *             record number
 *
 * Reads the snapshot, changes nothing. Disk access is the injected
 * identify (identify.js).
 */

import { screenPaths } from "../zap.js";
import { REFUSED, REMOVED, SYNTHETIC } from "./flags.js";
import { pathOf } from "./page.js";

/**
 * @param {object} snap
 * @param {unknown[]} recNos as the client sent them
 * @param {{identify: (path: string) => Promise<{isDir: boolean, recNo: number}|null>}} io
 * @returns {Promise<{paths: string[], items: Array<{path: string, bytes: string, recNo: number}>,
 *            bytes: string, refused: Array<{path: string, reason: string}>}>}
 */
export async function offerPicks(snap, recNos, { identify }) {
  const refused = [];
  const ids = resolve(snap, recNos, refused);
  const outer = dropNested(snap, ids);
  const screened = screen(snap, outer, refused);
  return confirmIdentity(screened, identify);
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
  const items = screened.allowed.map((full) => {
    const id = byPath.get(full);
    return { path: full, bytes: String(snap.bytes[id]), recNo: snap.recNo[id] };
  });

  return { items, refused: [...refused, ...screened.refused] };
}

async function confirmIdentity({ items, refused }, identify) {
  const found = await Promise.all(items.map((item) => identify(item.path)));
  const kept = [];
  const changed = [];
  items.forEach((item, i) => {
    const on = found[i];
    if (on?.isDir && on.recNo === item.recNo) kept.push(item);
    else changed.push({ path: item.path, reason: "changed since the map was read" });
  });
  return offered(kept, [...refused, ...changed]);
}

function offered(items, refused) {
  let total = 0;
  for (const item of items) total += Number(item.bytes);
  return { paths: items.map((i) => i.path), items, bytes: String(total), refused };
}
