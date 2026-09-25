/**
 * Resolve pack entries against this machine: the I/O around match.js.
 *
 * Everything comes from one MFT read per drive: whether a cache exists, where
 * it is, and how big it is. A path's size is the only thing that makes it
 * actionable, so there is no value in reporting existence sooner — an earlier
 * list is a list you cannot decide anything from.
 *
 * This path requires the MFT. There is no directory-walk fallback: a drive
 * whose MFT cannot be read is reported as an error and skipped.
 */

import path from "node:path";

import { readVolumeTree } from "../mft/scan.js";
import { buildNameQuery } from "../mft/filenames.js";
import { childIndex, subtreeSizes } from "../mft/tree.js";
import { matcherFor } from "./matchers/index.js";
import { collectNeeds } from "./needs.js";
import { matchTree } from "./match.js";
import { driveOf } from "./expand.js";

/**
 * @param {object[]} entries validated pack entries
 * @param {{drives: string[], env?: object, root?: string|null,
 *          onProgress?: (n: object) => void,
 *          onFound?: (found: object[]) => void,
 *          signal?: AbortSignal}} opts
 * @returns {Promise<{found: object[], errors: string[]}>}
 *   Rejects with the signal's reason once aborted; drives already reported
 *   through onFound stay reported.
 */
export async function resolveEntries(entries, {
  drives,
  env = process.env,
  root = null,
  onProgress = () => {},
  onFound = () => {},
  signal,
}) {
  const ctx = { env, drives, scope: root ? normalize(root) : null };
  const query = buildNameQuery(collectNeeds(entries));
  const queue = drivesToRead(entries, ctx, root);

  const found = [];
  const errors = [];

  for (const [index, drive] of queue.entries()) {
    signal?.throwIfAborted();
    // Position in the queue, so a long read can say how much is left.
    const where = { drive, driveIndex: index + 1, driveCount: queue.length };
    onProgress({ stage: "reading-mft", ...where });

    let volume;
    try {
      volume = await readVolumeTree(drive, {
        query,
        onProgress: (n) => onProgress({ ...n, ...where }),
        signal,
      });
    } catch (err) {
      // A stop is not a drive that failed to read.
      if (signal?.aborted) throw err;
      onProgress({ stage: "mft-failed", drive, reason: err.message });
      errors.push(`${drive} could not be read: ${err.message}`);
      continue;
    }

    const children = childIndex(volume.dirs);
    const tree = { dirs: volume.dirs, children, marks: volume.marks, drive };
    const { hits, refused } = matchTree(tree, entries, ctx);
    errors.push(...refused.map((r) => `${r.path} refused: ${r.reason}`));

    const sized = sizeHits(volume, children, hits);

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
 * Which drives are worth reading: with a root, only its drive; otherwise
 * every drive any entry's locate rules could touch.
 */
function drivesToRead(entries, ctx, root) {
  if (root) {
    const drive = driveOf(path.resolve(root));
    return drive ? [drive] : [];
  }

  const all = ctx.drives.map(driveOf).filter(Boolean);
  const wanted = new Set();

  for (const entry of entries) {
    for (const { key, spec } of entry.match) {
      const matcher = matcherFor(key);
      if (matcher.role !== "locate") continue;
      const drives = matcher.drives(spec, ctx);
      for (const drive of drives === "all" ? all : drives) wanted.add(drive);
    }
  }

  // Keep the machine's drive order rather than pack order.
  return all.filter((d) => wanted.has(d));
}

function sizeHits(volume, children, hits) {
  const totals = subtreeSizes(
    volume.dirs,
    volume.ownBytes,
    volume.ownFiles,
    hits.map((h) => h.record.recordNumber),
    children,
  );

  const sized = [];
  for (const hit of hits) {
    const total = totals.get(hit.record.recordNumber);
    if (!total) continue;
    sized.push(toHit(hit.entry, hit.path, total));
  }
  return sized;
}

function toHit(entry, full, total) {
  return {
    id: entry.id,
    label: entry.label,
    tool: entry.tool,
    pack: entry.pack,
    cost: entry.cost,
    risk: entry.risk,
    riskNote: entry.riskNote,
    path: full,
    bytes: total.bytes.toString(),
    files: total.files,
    perProject: entry.perProject,
    mode: "delete",
  };
}

function normalize(p) {
  return path.resolve(p).toLowerCase().replace(/\\+$/, "");
}
