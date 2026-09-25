/**
 * Decide which requested paths may go into a delete plan.
 *
 * Two gates, in order:
 *
 *   provenance  the path must be one a scan offered — the server does not
 *               trust the client's path list
 *   screen      the protected-folder and depth rules
 *
 * A path the cache scan offered skips only the depth rule: cache entries
 * are named paths screened when they were resolved, and several real stores
 * live at a drive root (D:\.pnpm-store). The protected-folder rules still
 * apply to them.
 *
 * Pure: the offered store and the screen are passed in.
 *
 * @param {unknown[]} paths as the client sent them
 * @param {{offered: {sourcesOf: (p: string) => string[]},
 *          screen: (paths: string[], opts?: {requireDepth?: boolean}) =>
 *                  {allowed: string[],
 *                   refused: Array<{path: string, reason: string}>}}} deps
 * @returns {{allowed: string[], refused: Array<{path: string, reason: string}>}}
 */
export function buildPlan(paths, { offered, screen }) {
  const deep = [];
  const named = [];
  const refused = [];

  for (const raw of paths) {
    const sources = typeof raw === "string" && raw !== "" ? offered.sourcesOf(raw) : [];
    if (sources.length === 0) {
      refused.push({ path: String(raw), reason: "not found by a scan" });
    } else if (sources.includes(DEPTH_WAIVED)) {
      named.push(raw);
    } else {
      deep.push(raw);
    }
  }

  const screenedDeep = screen(deep);
  const screenedNamed = screen(named, { requireDepth: false });
  return {
    allowed: [...screenedDeep.allowed, ...screenedNamed.allowed],
    refused: [...refused, ...screenedDeep.refused, ...screenedNamed.refused],
  };
}

// The one source whose offers skip the depth rule.
const DEPTH_WAIVED = "caches";
