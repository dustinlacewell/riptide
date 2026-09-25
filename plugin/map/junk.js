/**
 * Which folders on a drive are junk, for the space map.
 *
 * Two sources, the same ones the other tabs use:
 *
 *   caches     the cache packs, through matchTree — each hit marked safe or
 *              caution by its entry's risk, and labelled with the entry
 *   names      the Zap tab's folder-name patterns, outermost hits only
 *
 * A cache mark wins over a name mark on the same folder. A hit the
 * protected-path screen refuses is marked REFUSED and carries no junk mark,
 * so its bytes never count as reclaimable.
 *
 * Pure: the tree is already read.
 */

import { childIndex, findOutermostMatches, resolvePath } from "../mft/tree.js";
import { matchTree } from "../caches/match.js";
import { screenPaths } from "../zap.js";
import { CACHE_CAUTION, CACHE_SAFE, NAME_HIT, REFUSED } from "./flags.js";

/**
 * @param {{dirs: Map, marks: Map, drive: string}} volume
 * @param {{entries?: object[], patterns?: string[], drives?: string[],
 *          env?: object}} opts
 * @returns {Map<number, {flags: number, label?: string}>} by record number
 */
export function junkMarks(volume, { entries = [], patterns = [], drives = [], env = {} } = {}) {
  const marks = new Map();
  markNames(marks, volume, patterns);
  markCaches(marks, volume, entries, { env, drives, scope: null });
  return marks;
}

// ---------------------------------------------------------------------------

function markNames(marks, volume, patterns) {
  const wanted = new Set(patterns.map((p) => p.toLowerCase()));
  if (wanted.size === 0) return;

  for (const record of findOutermostMatches(volume.dirs, (name) => wanted.has(name.toLowerCase()))) {
    const full = resolvePath(volume.dirs, record, volume.drive);
    if (full === null) continue;
    const refused = screenPaths([full]).refused.length > 0;
    marks.set(record.recordNumber, { flags: refused ? REFUSED : NAME_HIT });
  }
}

function markCaches(marks, volume, entries, ctx) {
  if (entries.length === 0) return;
  const tree = {
    dirs: volume.dirs,
    children: childIndex(volume.dirs),
    marks: volume.marks ?? new Map(),
    drive: volume.drive,
  };
  const { hits, refused } = matchTree(tree, entries, ctx);

  for (const hit of hits) {
    const flags = hit.entry.risk === "caution" ? CACHE_CAUTION : CACHE_SAFE;
    marks.set(hit.record.recordNumber, { flags, label: hit.entry.label });
  }
  for (const r of refused) {
    if (r.record) marks.set(r.record.recordNumber, { flags: REFUSED });
  }
}
