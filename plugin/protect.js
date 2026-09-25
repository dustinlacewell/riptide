/**
 * Protected folders: the paths nothing in riptide may delete.
 *
 * Two kinds of rule:
 *
 *   subtree  the folder and everything beneath it. System folders whose
 *            contents are never a cache or a build output.
 *   exact    the folder itself only. Nearly every cache lives under a user
 *            profile, and several real ones live under ProgramData
 *            (C:\ProgramData\Dbg, GOG's webcache, VS packages), so their
 *            contents stay deletable.
 */

import path from "node:path";

const SUBTREES = new Set([
  "windows",
  "program files",
  "program files (x86)",
  "$recycle.bin",
  "system volume information",
]);

const EXACT = [
  /^[A-Za-z]:\\?$/,
  /^[A-Za-z]:\\ProgramData$/i,
  /^[A-Za-z]:\\Users$/i,
  /^[A-Za-z]:\\Users\\[^\\]+$/i,
];

/**
 * @param {string} full an absolute, resolved Windows path
 * @returns {string|null} why the path is protected, or null when it is not
 */
export function protectionOf(full) {
  if (insideSubtree(full)) return "inside a protected system folder";
  if (EXACT.some((re) => re.test(full))) return "protected system path";
  return null;
}

// Compares whole segments, so C:\Windowsold is not inside C:\Windows.
function insideSubtree(full) {
  const { root } = path.win32.parse(full);
  const top = full.slice(root.length).split("\\")[0].toLowerCase();
  return SUBTREES.has(top);
}
