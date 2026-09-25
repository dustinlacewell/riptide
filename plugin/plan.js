/**
 * Decide what may go into a plan: paths to delete and actions to run.
 *
 * A plan is a list of items, {kind: "path", path} or {kind: "action", id}.
 *
 * A path passes two gates, in order:
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
 * An action passes one gate: a cache scan offered it, which it does only
 * for an action it found available.
 *
 * Pure: the offered store and the screen are passed in.
 *
 * @param {{paths?: unknown[], actions?: unknown[]}} request as the client sent it
 * @param {{offered: {sourcesOf: (p: string) => string[],
 *                    actionSourcesOf: (id: string) => string[]},
 *          screen: (paths: string[], opts?: {requireDepth?: boolean}) =>
 *                  {allowed: string[],
 *                   refused: Array<{path: string, reason: string}>}}} deps
 * @returns {{items: Array<{kind: "path", path: string}|{kind: "action", id: string}>,
 *            refused: Array<{path: string, reason: string}>,
 *            refusedActions: Array<{id: string, reason: string}>}}
 */
export function buildPlan({ paths = [], actions = [] }, deps) {
  const screened = screenOffered(paths, deps);
  const chosen = offeredActions(actions, deps.offered);
  return {
    items: [
      ...screened.allowed.map((path) => ({ kind: "path", path })),
      ...chosen.allowed.map((id) => ({ kind: "action", id })),
    ],
    refused: screened.refused,
    refusedActions: chosen.refused,
  };
}

// ---------------------------------------------------------------------------

function screenOffered(paths, { offered, screen }) {
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

function offeredActions(ids, offered) {
  const allowed = [];
  const refused = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw : String(raw);
    if (allowed.includes(id)) continue;
    if (typeof raw === "string" && offered.actionSourcesOf(raw).length > 0) allowed.push(id);
    else refused.push({ id, reason: "not offered by a scan" });
  }
  return { allowed, refused };
}

// The one source whose offers skip the depth rule.
const DEPTH_WAIVED = "caches";
