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

/** @typedef {"safe"|"caution"|"refused"} Risk */

const NONE = new Set();

/**
 * @param {{path?: string, risk?: string}} item a scan hit or cache hit
 * @param {Set<string>} [refused] lower-cased paths the server refused
 * @returns {Risk}
 */
export function riskOf(item, refused = NONE) {
  if (item.path && refused.has(item.path.toLowerCase())) return "refused";
  if (item.risk === "caution") return "caution";
  return "safe";
}

/**
 * The lookup riskOf takes, from a plan's refused list. Windows paths compare
 * without case, so the set holds them lower-cased.
 *
 * @param {Array<{path: string}>} list
 * @returns {Set<string>}
 */
export function refusedPaths(list) {
  return new Set((list ?? []).map((r) => r.path.toLowerCase()));
}
