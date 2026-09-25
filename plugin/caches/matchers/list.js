/**
 * Shared parsing for matcher values that are lists of strings.
 */

/**
 * @param {unknown} value
 * @param {string} key the pack key, for the error message
 * @returns {string[] | {error: string}}
 *
 * Strict: an empty list, a blank string or a non-string is an error, never
 * skipped. A filter that parsed to nothing would stop filtering, which
 * widens what gets deleted.
 */
export function parseStringList(value, key) {
  if (!Array.isArray(value)) return { error: `${key} must be an array of strings` };
  if (value.length === 0) return { error: `${key} is empty` };
  const bad = value.findIndex((v) => typeof v !== "string" || v.trim() === "");
  if (bad !== -1) return { error: `${key} has a blank or non-string item` };
  return value;
}
