/**
 * One comparable form for a Windows path: resolved, no trailing separator
 * (except on a drive root), lower-cased.
 *
 *   c:\foo\   -> c:\foo
 *   C:/foo    -> c:\foo
 *   C:\FOO    -> c:\foo
 *   C:        -> c:\
 *
 * The server-side twin of src/pathKey.js. It uses path.win32 so the key is
 * the same whatever platform runs the tests.
 */

import path from "node:path";

/**
 * @param {string} p
 * @returns {string}
 */
export function pathKey(p) {
  const full = path.win32.resolve(String(p));
  const { root } = path.win32.parse(full);
  const trimmed = full.length > root.length ? full.replace(/\\+$/, "") : full;
  return trimmed.toLowerCase();
}
