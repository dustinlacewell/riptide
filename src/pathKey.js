/**
 * One comparable form for a Windows path, the way the server's
 * path.resolve would write it, then lower-cased.
 *
 *   C:/Windows/      -> c:\windows
 *   c:\windows\.\x\.. -> c:\windows
 *   C:               -> c:\
 *
 * Pure string work: the browser has no node:path. Relative paths are not
 * resolved against a working directory — every path here came from a scan
 * and is already absolute.
 *
 * @param {string} p
 * @returns {string}
 */
export function pathKey(p) {
  const unified = String(p).replace(/\//g, "\\");
  const drive = /^[A-Za-z]:/.exec(unified)?.[0] ?? "";
  const rest = unified.slice(drive.length);

  const parts = [];
  for (const part of rest.split("\\")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }

  const lead = drive || rest.startsWith("\\") ? "\\" : "";
  return `${drive}${lead}${parts.join("\\")}`.toLowerCase();
}
