/**
 * Resolve pack entries against this machine.
 *
 * Everything comes from one MFT read per drive: whether a cache exists, where
 * it is, and how big it is. A path's size is the only thing that makes it
 * actionable, so there is no value in reporting existence sooner — an earlier
 * list is a list you cannot decide anything from.
 *
 * Two kinds of entry resolve the same way:
 *
 *   fixed paths   walked down the tree segment by segment from the root
 *   dirNames      matched by name anywhere in the tree
 */

import path from "node:path";

import { readVolumeTree } from "../mft/scan.js";
import { subtreeSizes, resolvePath } from "../mft/tree.js";
import { candidatePaths } from "./pack.js";
import { screenPaths } from "../zap.js";

const ROOT_RECORD = 5;

/**
 * @param {object[]} entries validated pack entries
 * @param {{drives: string[], env?: object, root?: string|null,
 *          onProgress?: (n: object) => void,
 *          onFound?: (found: object[]) => void}} opts
 * @returns {Promise<{found: object[], errors: string[]}>}
 */
export async function resolveEntries(entries, {
  drives,
  env = process.env,
  root = null,
  onProgress = () => {},
  onFound = () => {},
}) {
  const scope = root ? normalize(root) : null;

  // Every absolute path any entry could occupy, grouped by the entry that
  // named it. Existence is decided later, from the MFT.
  const wanted = [];
  for (const entry of entries) {
    for (const full of candidatePaths(entry, drives, env)) {
      wanted.push({ entry, path: full });
    }
  }

  // A pack could name a path that must never be deleted. The same screen the
  // Zap tab uses decides that, so there is one rule, not two. Depth is
  // waived: a pack names an exact path, and real stores do sit at a drive
  // root (D:\.pnpm-store). The protected-path list still applies.
  const screened = screenPaths(wanted.map((w) => w.path), { requireDepth: false });
  const allowed = new Set(screened.allowed.map((p) => p.toLowerCase()));
  const errors = screened.refused.map((r) => `${r.path} refused: ${r.reason}`);

  const candidates = wanted.filter(
    (w) => allowed.has(w.path.toLowerCase()) && (!scope || withinScope(w.path, scope)),
  );

  const rules = projectRules(entries);

  const found = [];
  const queue = drivesToRead({ candidates, rules, drives, root });

  for (const [index, drive] of queue.entries()) {
    // Position in the queue, so a long read can say how much is left.
    const where = { drive, driveIndex: index + 1, driveCount: queue.length };
    onProgress({ stage: "reading-mft", ...where });

    let tree;
    try {
      tree = await readVolumeTree(drive, (n) => onProgress({ ...n, ...where }));
    } catch (err) {
      onProgress({ stage: "mft-failed", drive, reason: err.message });
      errors.push(`${drive} could not be read: ${err.message}`);
      continue;
    }

    const hits = [
      ...fixedPathHits(tree, candidates.filter((c) => onDrive(c.path, drive))),
      ...namedDirHits(tree, rules, scope),
    ];

    const totals = subtreeSizes(
      tree.dirs,
      tree.ownBytes,
      tree.ownFiles,
      hits.map((h) => h.record),
    );

    const sized = [];
    for (const hit of hits) {
      const total = totals.get(hit.record);
      if (!total) continue;
      sized.push({
        ...hit.entry,
        path: hit.path,
        bytes: total.bytes.toString(),
        files: total.files,
      });
    }

    // This drive is finished; hand its results over rather than holding them
    // until every other drive has been read.
    if (sized.length > 0) {
      found.push(...sized);
      onFound(sized);
    }
  }

  return { found, errors };
}

// ---------------------------------------------------------------------------

/**
 * Which drives are worth reading.
 *
 * With a root, only its drive. Without one, any drive named by a candidate
 * path, plus every drive when a dirName rule could match anywhere.
 */
function drivesToRead({ candidates, rules, drives, root }) {
  const wanted = new Set();

  if (root) {
    const drive = driveOf(path.resolve(root));
    if (drive) wanted.add(drive);
    return [...wanted];
  }

  for (const candidate of candidates) {
    const drive = driveOf(candidate.path);
    if (drive) wanted.add(drive);
  }

  if (rules.length > 0) {
    for (const drive of drives) {
      const letter = driveOf(drive);
      if (letter) wanted.add(letter);
    }
  }

  return [...wanted];
}

/**
 * Entries located by directory name rather than a fixed path.
 */
function projectRules(entries) {
  return entries
    .filter((e) => e.dirNames?.length > 0)
    .map((e) => ({
      dirNames: e.dirNames,
      under: e.under,
      entry: describe(e, { perProject: true }),
    }));
}

function describe(entry, extra = {}) {
  return {
    id: entry.id,
    label: entry.label,
    tool: entry.tool,
    pack: entry.pack,
    cost: entry.cost,
    caution: entry.caution,
    ...extra,
  };
}

/**
 * Resolve fixed paths to MFT records.
 *
 * Building the full path of every directory on the volume would be wasteful
 * when only a handful are wanted, so this walks down from the root one
 * segment at a time instead, following the child index. A path that does not
 * resolve simply does not exist on this machine.
 */
function fixedPathHits(tree, candidates) {
  if (candidates.length === 0) return [];

  const childrenOf = indexChildren(tree);
  const hits = [];

  for (const { entry, path: full } of candidates) {
    const segments = full.slice(3).split(/[\\/]+/).filter(Boolean);

    let current = ROOT_RECORD;
    let ok = true;

    for (const segment of segments) {
      const match = (childrenOf.get(current) ?? []).find(
        (child) => child.name.toLowerCase() === segment.toLowerCase(),
      );
      if (!match) {
        ok = false;
        break;
      }
      current = match.recordNumber;
    }

    if (ok) hits.push({ entry: describe(entry), path: full, record: current });
  }

  return hits;
}

/**
 * Find directories matching a pack's dirName rules.
 *
 * A rule may require a parent name: Vite's cache is node_modules/.vite, so
 * `under: "node_modules"` keeps an unrelated .vite from matching. Nested hits
 * are dropped — a target inside a target is already covered by its ancestor,
 * and counting both would double the reported bytes.
 */
function namedDirHits(tree, rules, scope) {
  if (rules.length === 0) return [];

  const wanted = new Map();
  for (const rule of rules) {
    for (const name of rule.dirNames) {
      const key = name.toLowerCase();
      if (!wanted.has(key)) wanted.set(key, []);
      wanted.get(key).push(rule);
    }
  }

  const matched = [];
  for (const rec of tree.dirs.values()) {
    const candidates = wanted.get(rec.name.toLowerCase());
    if (!candidates) continue;

    const parent = tree.dirs.get(rec.parent);
    for (const rule of candidates) {
      if (rule.under && parent?.name.toLowerCase() !== rule.under.toLowerCase()) {
        continue;
      }
      matched.push({ rec, entry: rule.entry });
      break;
    }
  }

  const matchedRecords = new Set(matched.map((m) => m.rec.recordNumber));

  return matched
    .filter((m) => !hasMatchingAncestor(tree.dirs, m.rec, matchedRecords))
    .map((m) => ({
      entry: m.entry,
      record: m.rec.recordNumber,
      path: resolvePath(tree.dirs, m.rec, tree.drive),
    }))
    .filter((hit) => hit.path !== null)
    .filter((hit) => !scope || withinScope(hit.path, scope));
}

function indexChildren(tree) {
  const childrenOf = new Map();
  for (const rec of tree.dirs.values()) {
    let list = childrenOf.get(rec.parent);
    if (!list) childrenOf.set(rec.parent, (list = []));
    list.push(rec);
  }
  return childrenOf;
}

function hasMatchingAncestor(dirs, record, matchedRecords) {
  const seen = new Set([record.recordNumber]);
  let current = dirs.get(record.parent);

  while (current && current.recordNumber !== ROOT_RECORD) {
    if (seen.has(current.recordNumber)) return false;
    seen.add(current.recordNumber);
    if (matchedRecords.has(current.recordNumber)) return true;
    current = dirs.get(current.parent);
  }

  return false;
}

/**
 * Is `full` the scope directory or inside it?
 *
 * The separator check stops "D:\code" from matching "D:\code-archive".
 */
function withinScope(full, scope) {
  const lower = full.toLowerCase();
  return lower === scope || lower.startsWith(scope + "\\");
}

function onDrive(full, drive) {
  return driveOf(full) === drive;
}

function driveOf(full) {
  const drive = full.slice(0, 2).toUpperCase();
  return /^[A-Z]:$/.test(drive) ? drive : null;
}

function normalize(p) {
  return path.resolve(p).toLowerCase().replace(/\\+$/, "");
}
