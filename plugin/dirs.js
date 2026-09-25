/**
 * Directory listing for the browse dialog.
 *
 * The picker needs one thing the scan does not: the immediate children of a
 * path, cheaply, with enough detail to render a row. That means never
 * failing the whole listing because one child is unreadable, and never
 * descending — a browse step is one readdir, not a walk.
 */

import path from "node:path";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * List the immediate subdirectories of `dir`.
 *
 * @param {string} dir
 * @returns {Promise<{path: string, parent: string|null, entries: Array<{name: string, path: string, hidden: boolean, accessible: boolean}>}>}
 * @throws {Error} with `code = "ENOTDIR"` when the path is missing or is a file
 */
export async function listDirs(dir) {
  const resolved = path.resolve(dir);

  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw notADirectory(`no such directory: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw notADirectory(`not a directory: ${resolved}`);
  }

  let dirents;
  try {
    dirents = await fsp.readdir(resolved, { withFileTypes: true });
  } catch (err) {
    throw notADirectory(`cannot read directory: ${resolved} (${err.code ?? err.message})`);
  }

  const hidden = await hiddenNames(resolved);

  const entries = await Promise.all(
    dirents.map((entry) => describe(resolved, entry, hidden)),
  );

  return {
    path: resolved,
    parent: parentOf(resolved),
    entries: entries.filter(Boolean).sort(byName),
  };
}

/**
 * Turn one dirent into a row, or null if it does not belong in the list.
 *
 * A symlink or junction is dropped rather than followed: a browse tree that
 * can loop back on itself is worse than one that omits a shortcut.
 */
async function describe(parent, entry, hidden) {
  if (entry.isSymbolicLink()) return null;

  const full = path.join(parent, entry.name);

  // readdir's type is usually enough, but a reparse point or a race can
  // leave it unknown; only then does a row cost a stat.
  let isDir = entry.isDirectory();
  let accessible = true;

  if (!isDir && !entry.isFile()) {
    try {
      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink()) return null;
      isDir = stat.isDirectory();
    } catch {
      // One unreadable child must not sink the listing. It is simply not
      // a directory as far as this listing is concerned.
      return null;
    }
  }

  if (!isDir) return null;

  // Whether the row can be descended into. A directory the user cannot open
  // still belongs on the list — showing it dimmed explains the gap better
  // than silently omitting it.
  //
  // fs.access is not the probe to use: on Windows it reports the read-only
  // attribute, not the ACL, and answers OK for a directory a deny entry
  // makes unreadable. Opening the handle is what readdir would do.
  try {
    const handle = await fsp.opendir(full);
    await handle.close();
  } catch {
    accessible = false;
  }

  return { name: entry.name, path: full, hidden: hidden.has(entry.name.toLowerCase()), accessible };
}

/** Case-insensitive by name, the order a file manager uses. */
function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * The parent directory, or null at a drive root.
 *
 * `path.dirname("C:\\")` returns "C:\\" — the fixed point marks the top of
 * the tree, which is what the caller needs to know.
 */
export function parentOf(dir) {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved);
  return parent === resolved ? null : parent;
}

/**
 * Names under `dir` carrying FILE_ATTRIBUTE_HIDDEN or FILE_ATTRIBUTE_SYSTEM.
 *
 * Node's fs.Stats does not expose Windows file attributes — not via `mode`,
 * not with `bigint: true`, not on Dirent. `attrib /D` reports them for every
 * child in one spawn (~25ms for a large root), which beats a per-entry probe
 * and beats guessing from the name. If it fails for any reason the listing
 * still renders; nothing is marked hidden.
 */
async function hiddenNames(dir) {
  if (process.platform !== "win32") return new Set();

  try {
    const { stdout } = await execFileAsync("attrib", ["/D", path.join(dir, "*")], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseAttrib(stdout);
  } catch {
    return new Set();
  }
}

/**
 * Pull the hidden and system names out of `attrib /D` output.
 *
 * Each line is a fixed-width flag field followed by an absolute path:
 *
 *     A  SH                C:\DumpStack.log.tmp
 *         H   I            C:\ProgramData
 *
 * The flags are read from the field before the path, so a directory whose
 * own name contains an H or S is not mistaken for a hidden one.
 *
 * @param {string} stdout
 * @returns {Set<string>} lowercased base names
 */
export function parseAttrib(stdout) {
  const names = new Set();

  for (const line of stdout.split(/\r?\n/)) {
    const at = line.search(/[A-Za-z]:[\\/]/);
    if (at < 0) continue;

    const flags = line.slice(0, at);
    if (!/[HS]/.test(flags)) continue;

    const name = path.basename(line.slice(at).trim());
    if (name) names.add(name.toLowerCase());
  }

  return names;
}

function notADirectory(message) {
  const err = new Error(message);
  err.code = "ENOTDIR";
  return err;
}
