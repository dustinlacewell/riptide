/**
 * Protected folders: the paths nothing in riptide may delete.
 *
 * Two kinds of rule:
 *
 *   subtree  the folder and everything beneath it. System folders whose
 *            contents are never a cache or a build output, and folders of
 *            keys.
 *   exact    the folder itself only. Nearly every cache lives under a user
 *            profile — in AppData, in Documents — and several real ones
 *            live under ProgramData (C:\ProgramData\Dbg, GOG's webcache, VS
 *            packages), so their contents stay deletable.
 *
 * Every rule matches whole segments, so C:\Windowsold is not inside
 * C:\Windows.
 */

import path from "node:path";

const SYSTEM = "inside a protected system folder";
const KEYS = "inside a folder of keys";
const EXACT_SYSTEM = "protected system path";
const EXACT_USER = "protected user folder";

// Top-level folders on any drive. Every "$" folder is NTFS or Windows
// setup state: $Recycle.Bin, $Extend, $WinREAgent, $SysReset, $Windows.~BT.
const TOP_SUBTREES = new Set([
  "windows",
  "program files",
  "program files (x86)",
  "system volume information",
  "recovery",
  "boot",
  "efi",
]);

const DRIVE = String.raw`^[A-Za-z]:`;
const PROFILE = String.raw`${DRIVE}\\Users\\[^\\]+`;
const KNOWN = String.raw`Desktop|Documents|Downloads|Pictures|Music|Videos|OneDrive(?: - [^\\]+)?|source`;

const SUBTREES = [
  { re: new RegExp(String.raw`${DRIVE}\\ProgramData\\Microsoft(?:\\|$)`, "i"), reason: SYSTEM },
  { re: new RegExp(String.raw`${DRIVE}\\Users\\(?:Public|Default|Default User|All Users)(?:\\|$)`, "i"), reason: SYSTEM },
  { re: new RegExp(String.raw`${PROFILE}\\(?:\.ssh|\.gnupg)(?:\\|$)`, "i"), reason: KEYS },
];

// Caches that live inside a protected subtree. Each one, and everything
// beneath it, is let through the SUBTREES rules above — nothing else.
const CARVE_OUTS = [
  // Visual Studio's package cache (the vs-packages pack entry).
  new RegExp(String.raw`${DRIVE}\\ProgramData\\Microsoft\\VisualStudio\\Packages(?:\\|$)`, "i"),
];

const EXACT = [
  { re: new RegExp(String.raw`${DRIVE}\\?$`), reason: EXACT_SYSTEM },
  { re: new RegExp(String.raw`${DRIVE}\\ProgramData$`, "i"), reason: EXACT_SYSTEM },
  { re: new RegExp(String.raw`${DRIVE}\\Users$`, "i"), reason: EXACT_SYSTEM },
  { re: new RegExp(String.raw`${PROFILE}$`, "i"), reason: EXACT_SYSTEM },
  { re: new RegExp(String.raw`${PROFILE}\\AppData(?:\\(?:Local|Roaming|LocalLow))?$`, "i"), reason: EXACT_SYSTEM },
  { re: new RegExp(String.raw`${PROFILE}\\(?:${KNOWN})$`, "i"), reason: EXACT_USER },
];

/**
 * @param {string} full an absolute, resolved Windows path
 * @returns {string|null} why the path is protected, or null when it is not
 */
export function protectionOf(full) {
  if (insideTopSubtree(full)) return SYSTEM;
  const rule = insideSubtree(full) ?? EXACT.find(({ re }) => re.test(full));
  return rule?.reason ?? null;
}

function insideSubtree(full) {
  if (CARVE_OUTS.some((re) => re.test(full))) return undefined;
  return SUBTREES.find(({ re }) => re.test(full));
}

function insideTopSubtree(full) {
  const { root } = path.win32.parse(full);
  const top = full.slice(root.length).split("\\")[0].toLowerCase();
  return TOP_SUBTREES.has(top) || top.startsWith("$");
}
