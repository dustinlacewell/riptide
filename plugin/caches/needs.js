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
