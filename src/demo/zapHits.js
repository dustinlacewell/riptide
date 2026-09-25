/**
 * The Zap tab's hits on the demo drive: every live folder whose name is one
 * of the patterns, as the server's /scan reports it. A hit's own subtree is
 * not searched again, the way the real scan stops at a match.
 *
 * The drive holds one hit under C:\Windows, which the plan refuses.
 */

const DAY_MS = 86_400_000;
const DEFAULT_AGE_DAYS = 30;

/** "node_modules, dist target" -> Set {"node_modules", "dist", "target"} */
export function namesOf(patterns) {
  return new Set(
    String(patterns ?? "")
      .split(/[,\s]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * @param {object} index from indexTree
 * @param {Array} sized from measure
 * @param {Set<string>} names lower-cased folder names
 * @param {number} now wall-clock ms; mtimes are this minus each folder's age
 * @returns {Array<{path: string, bytes: string, files: number, mtime: number}>}
 */
export function zapHits(index, sized, names, now) {
  const hits = [];
  const walk = (id) => {
    const node = index.nodes[id];
    if (names.has(node.name.toLowerCase())) {
      hits.push({
        path: node.path,
        bytes: String(sized[id].bytes),
        files: sized[id].files,
        mtime: now - (node.age ?? DEFAULT_AGE_DAYS) * DAY_MS,
      });
      return;
    }
    for (const kid of sized[id].live) walk(kid);
  };
  if (sized[0]) walk(0);
  return hits;
}
