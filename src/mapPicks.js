/**
 * Folders picked on the space map, as data.
 *
 * Picks are keyed by snapshot id and outlive navigation: pick a folder, go
 * elsewhere, pick another. Each holds what the tray and the reclaim meter
 * show, so neither needs the page it came from.
 *
 * Pure. Every function returns a new Map.
 */

/**
 * @typedef {{id: number, recNo: number, name: string, bytes: number,
 *            junk: string|null}} Pick
 */

/** Add the row, or take it out when it is already picked. */
export function togglePick(picks, row) {
  const next = new Map(picks);
  if (next.has(row.id)) next.delete(row.id);
  else next.set(row.id, pickOf(row));
  return next;
}

/** Take out one pick. */
export function dropPick(picks, id) {
  const next = new Map(picks);
  next.delete(id);
  return next;
}

/** Take out every pick whose record number is in `recNos`. */
export function dropRecords(picks, recNos) {
  const gone = new Set(recNos);
  return new Map([...picks].filter(([, pick]) => !gone.has(pick.recNo)));
}

/**
 * Picks in the shape reclaimOf reads: bytes as a string, risk caution for
 * a caution cache.
 *
 * @returns {Array<{bytes: string, risk: "safe"|"caution"}>}
 */
export function reclaimItems(picks) {
  return [...picks.values()].map((pick) => ({
    bytes: String(Math.round(pick.bytes)),
    risk: pick.junk === "cache-caution" ? "caution" : "safe",
  }));
}

function pickOf(row) {
  return { id: row.id, recNo: row.recNo, name: row.name, bytes: row.bytes, junk: row.junk ?? null };
}
