/**
 * The file names the MFT read must watch for.
 *
 * Filters such as `beside: ["Cargo.toml"]` ask about files, and files are
 * dropped as the MFT streams. So before the read, every enabled entry's
 * filters are asked what file names they need, and the union becomes one
 * query. A disabled entry adds nothing — and with no file filters enabled,
 * the query is empty and the read pays nothing.
 */

import { matcherFor } from "./matchers/index.js";
import { PROJECT_MARKERS } from "./projects.js";

/**
 * @param {Array<{match: Array<{key: string, spec: object}>}>} entries enabled
 * @returns {string[]} distinct file patterns ("cargo.toml", "*.csproj")
 */
export function collectNeeds(entries) {
  const out = new Set();
  for (const entry of entries) {
    for (const { key, spec } of entry.match) {
      const matcher = matcherFor(key);
      if (matcher.role !== "filter") continue;
      for (const pattern of matcher.needs(spec)) out.add(pattern.toLowerCase());
    }
  }
  return [...out];
}

/**
 * The project markers, when any enabled entry is per-project: its hits are
 * dated by their project (projects.js), and a project root is found by the
 * manifest files the stream marks. Only the cache scan asks; the space map
 * does not date hits and does not pay for the marks.
 *
 * @param {Array<{perProject: boolean}>} entries enabled
 * @returns {string[]}
 */
export function projectNeeds(entries) {
  return entries.some((e) => e.perProject) ? PROJECT_MARKERS : [];
}

/**
 * Every file pattern any loaded entry could ask for, enabled or not, and
 * the project markers. A tree kept between requests is read with these,
 * so turning an entry on never forces the MFT to be read again.
 *
 * @param {Array<{match: Array<{key: string, spec: object}>}>} entries all loaded
 * @returns {string[]}
 */
export function standingNeeds(entries) {
  return [...new Set([...collectNeeds(entries), ...PROJECT_MARKERS.map((p) => p.toLowerCase())])];
}
