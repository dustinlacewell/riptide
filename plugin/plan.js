/**
 * Decide which requested paths may go into a delete plan.
 *
 * Two gates, in order:
 *
 *   provenance  the path must be one a scan offered — the server does not
 *               trust the client's path list
 *   screen      the protected-folder and depth rules
 *
 * Pure: the offered store and the screen are passed in.
 *
 * @param {unknown[]} paths as the client sent them
 * @param {{offered: {has: (p: string) => boolean},
 *          screen: (paths: string[]) => {allowed: string[],
 *                   refused: Array<{path: string, reason: string}>}}} deps
 * @returns {{allowed: string[], refused: Array<{path: string, reason: string}>}}
 */
export function buildPlan(paths, { offered, screen }) {
  const known = [];
  const refused = [];

  for (const raw of paths) {
    if (typeof raw === "string" && raw !== "" && offered.has(raw)) {
      known.push(raw);
    } else {
      refused.push({ path: String(raw), reason: "not found by a scan" });
    }
  }

  const screened = screen(known);
  return { allowed: screened.allowed, refused: [...refused, ...screened.refused] };
}
