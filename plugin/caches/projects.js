/**
 * Which project a per-project cache belongs to, and when that project was
 * last worked on.
 *
 * A project root is the nearest folder above a hit that holds a project
 * marker — a manifest the MFT stream marked (package.json, Cargo.toml, …)
 * or a .git folder. A .git root wins over a nearer manifest: a monorepo is
 * one project, and its packages are not projects of their own.
 *
 * Last touched is the newest file time anywhere in the project, leaving out
 * every cache hit of this pass and .git: those change without anyone working
 * on the project.
 *
 * Pure: a function of the tree, the stream's tallies and the hits.
 */

import { markId } from "../mft/filenames.js";
import { subtreeLatest } from "../mft/latest.js";

/** Files that make a folder a project root. */
export const PROJECT_MARKERS = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "*.csproj",
  "*.sln",
  "Package.swift",
  "CMakeLists.txt",
];

const GIT = ".git";

/**
 * The project and its last-touched time for each hit.
 *
 * @param {{dirs: Map, children: Map, marks: Map}} tree
 * @param {Map<number, number>} ownLatest newest file time per folder, ms
 * @param {object[]} records every hit's folder record from this pass
 * @param {string[]} [markers]
 * @returns {Map<number, {record: object, lastTouched: number|null}|null>}
 *          hit record number -> its project, null when it has none
 */
export function projectsOf(tree, ownLatest, records, markers = PROJECT_MARKERS) {
  const memo = new Map();
  const rootOf = new Map(records.map((r) => [r.recordNumber, projectOf(tree, r, markers, memo)]));

  const junk = new Set(records.map((r) => r.recordNumber));
  const roots = new Set([...rootOf.values()].filter(Boolean).map((r) => r.recordNumber));
  const latest = subtreeLatest(
    tree.children,
    ownLatest,
    roots,
    (rec) => junk.has(rec.recordNumber) || isGit(rec),
  );

  const out = new Map();
  for (const [hit, root] of rootOf) {
    out.set(hit, root ? { record: root, lastTouched: latest.get(root.recordNumber) } : null);
  }
  return out;
}

/**
 * The project root above `record`, or null.
 *
 * @param {{dirs: Map, children: Map, marks: Map}} tree
 * @param {object} record a folder record
 * @param {string[]} markers file patterns, as PROJECT_MARKERS
 * @param {Map<number, {git: number|null, marker: number|null}>} [memo]
 *        shared across calls in one pass; ancestors are answered once
 * @returns {object|null} the root's folder record
 */
export function projectOf(tree, record, markers, memo = new Map()) {
  if (record.parent === record.recordNumber) return null;
  const ids = markers.map(markId);
  const nearest = nearestAbove(tree, record.parent, ids, memo);
  const root = nearest.git ?? nearest.marker;
  return root === null ? null : (tree.dirs.get(root) ?? null);
}

// ---------------------------------------------------------------------------

const NONE = { git: null, marker: null };

/**
 * The nearest .git holder and nearest marker holder at or above `start`.
 * Climbs until an answered folder, the volume root or a break in the chain,
 * then answers every folder on the way back down.
 */
function nearestAbove(tree, start, ids, memo) {
  const chain = [];
  const seen = new Set();
  let number = start;
  let above = NONE;

  while (true) {
    if (memo.has(number)) {
      above = memo.get(number);
      break;
    }
    const dir = tree.dirs.get(number);
    if (!dir || seen.has(number)) break; // broken or cyclic chain
    seen.add(number);
    chain.push(number);
    if (dir.parent === number) break; // the volume root
    number = dir.parent;
  }

  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    above = {
      git: holdsGit(tree, n) ? n : above.git,
      marker: holdsMarker(tree, n, ids) ? n : above.marker,
    };
    memo.set(n, above);
  }
  return above;
}

function holdsGit(tree, number) {
  return (tree.children.get(number) ?? []).some(isGit);
}

function holdsMarker(tree, number, ids) {
  const marked = tree.marks?.get(number);
  return marked !== undefined && ids.some((id) => marked.has(id));
}

function isGit(record) {
  return record.name.toLowerCase() === GIT;
}
