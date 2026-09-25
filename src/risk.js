/**
 * How dangerous a row is to delete.
 *
 *   safe     rebuilds or re-downloads by itself
 *   caution  costs something to get back (the engine sets risk: "caution")
 *   refused  the server screened the path out; it is never deleted
 *
 * Refused wins over everything: a path the server will not delete is not
 * worth warning about.
 */

import { pathKey } from "./pathKey.js";

/** @typedef {"safe"|"caution"|"refused"} Risk */

const NONE = new Set();

/**
 * @param {{path?: string, risk?: string}} item a scan hit or cache hit
 * @param {Set<string>} [refused] from refusedPaths
 * @returns {Risk}
 */
export function riskOf(item, refused = NONE) {
  if (item.path && refused.has(pathKey(item.path))) return "refused";
  if (item.risk === "caution") return "caution";
  return "safe";
}

/**
 * The lookup riskOf takes, from a plan's refused list. The server writes
 * refused paths through path.resolve; both sides go through pathKey so a
 * separator, trailing slash or case difference cannot hide a refusal.
 *
 * @param {Array<{path: string}>} list
 * @returns {Set<string>}
 */
export function refusedPaths(list) {
  return new Set((list ?? []).map((r) => pathKey(r.path)));
}
