/**
 * Check on disk, at plan time, that a cache hit still has the marker its
 * rule found it by.
 *
 * A `beside` or `contains` rule is only as right as the tree it ran on. The
 * tree may be one kept between requests and updated from the change
 * journal; if the update ever misses a change, a `target` could be offered
 * next to a Cargo.toml that is gone. So before a path goes into a plan,
 * its markers are looked for again with a plain directory listing.
 *
 *   markersOf(entry)        what a rule needs, as plain data to store
 *   verifyMarkers(paths)    split paths into kept and refused
 *
 * The listing (readdir) is injected; the matching is pure.
 */

import fsp from "node:fs/promises";
import path from "node:path";

import { compileGlob } from "./glob.js";
import { buildNameQuery, matchName } from "../mft/filenames.js";

const WHERE = ["beside", "contains"];

/**
 * @param {{match: Array<{key: string, spec: object}>}} entry a pack entry
 * @returns {Array<{key: "beside"|"contains", folders: string[], files: string[]}>}
 */
export function markersOf(entry) {
  return entry.match
    .filter(({ key }) => WHERE.includes(key))
    .map(({ key, spec }) => ({
      key,
      folders: spec.folders.map((f) => f.pattern),
      files: [...spec.files],
    }));
}

/**
 * Keep a path only while every marker rule on it still holds. A rule holds
 * when ANY of its names is there: a file by exact name or *.ext, a folder
 * by its glob — case ignored, as NTFS ignores it.
 *
 * @param {string[]} paths
 * @param {{markersOf: (p: string) => object[],
 *          readdir?: (dir: string) => Promise<Array<{name: string,
 *                    isFile: () => boolean, isDirectory: () => boolean}>>}} deps
 * @returns {Promise<{kept: string[], refused: Array<{path: string, reason: string}>}>}
 */
export async function verifyMarkers(paths, { markersOf: needsOf, readdir = listDir }) {
  const kept = [];
  const refused = [];
  for (const full of paths) {
    const failed = await firstMissing(full, needsOf(full), readdir);
    if (failed) refused.push({ path: full, reason: reasonFor(failed) });
    else kept.push(full);
  }
  return { kept, refused };
}

// ---------------------------------------------------------------------------

async function firstMissing(full, needs, readdir) {
  for (const need of needs) {
    const dir = need.key === "beside" ? path.dirname(full) : full;
    const self = need.key === "beside" ? path.basename(full).toLowerCase() : null;
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      return need;
    }
    if (!holds(entries, need, self)) return need;
  }
  return null;
}

/** Does a listing hold any of the rule's names? */
export function holds(entries, { folders, files }, self = null) {
  const query = files.length > 0 ? buildNameQuery(files) : null;
  const globs = folders.map(compileGlob);
  return entries.some((e) => {
    if (e.isFile() && query) return matchName(query, e.name).length > 0;
    if (e.isDirectory() && e.name.toLowerCase() !== self) return globs.some((test) => test(e.name));
    return false;
  });
}

function reasonFor({ key, folders, files }) {
  const marker = [...folders.map((f) => `${f}/`), ...files].join(", ");
  return key === "beside" ? `no longer next to ${marker}` : `no longer contains ${marker}`;
}

function listDir(dir) {
  return fsp.readdir(dir, { withFileTypes: true });
}
