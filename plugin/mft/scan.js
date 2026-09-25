/**
 * Volume scanning: the imperative shell around the pure MFT parsers.
 *
 * Two strategies:
 *
 *   mft  — open the raw volume, stream the MFT, rebuild the tree. Fast:
 *          one big sequential read instead of millions of directory reads.
 *          Needs a raw volume handle, which the OS may refuse.
 *
 *   walk — ordinary recursive directory read, pruning at each match so we
 *          never descend into the matched subtree. Always available.
 *
 * scanVolume() tries mft and falls back to walk, reporting which ran.
 *
 * Every loop takes an optional AbortSignal and checks it between chunks or
 * directory levels. An aborted run throws the signal's reason, closes what
 * it opened, and never falls back to the other strategy.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { parseBootSector } from "./boot.js";
import { runsToByteRanges } from "./runlist.js";
import { applyFixup, parseFileRecord, extractMftRuns } from "./record.js";
import { markFile } from "./filenames.js";
import {
  resolvePath,
  subtreeSizes,
  findOutermostMatches,
} from "./tree.js";

const READ_CHUNK = 8 * 1024 * 1024;

// A file-name query that marks this many folders is not asking a narrow
// question; holding the answer would cost memory the stream exists to save.
const MAX_MARKS = 1_000_000;

/**
 * @param {{root: string, matches: (name: string) => boolean,
 *          onProgress?: (n: {stage: string, count?: number}) => void,
 *          signal?: AbortSignal}} opts
 * @returns {Promise<{strategy: "mft"|"walk", reason?: string,
 *                    hits: Array<{path: string, bytes: string, files: number,
 *                                 mtime: string|null}>}>}
 */
export async function scanVolume({ root, matches, onProgress = () => {}, signal }) {
  const drive = driveLetterOf(root);

  if (drive) {
    try {
      const hits = await scanViaMft({ drive, root, matches, onProgress, signal });
      return { strategy: "mft", hits };
    } catch (err) {
      // A stop is not a failed MFT read; walking the tree instead would
      // carry on with the work the caller just cancelled.
      signal?.throwIfAborted();
      onProgress({ stage: "mft-unavailable", reason: err.message });
      const hits = await scanViaWalk({ root, matches, onProgress, signal });
      return { strategy: "walk", reason: err.message, hits };
    }
  }

  const hits = await scanViaWalk({ root, matches, onProgress, signal });
  return { strategy: "walk", reason: "root is not a drive path", hits };
}

// ---------------------------------------------------------------------------
// MFT strategy
// ---------------------------------------------------------------------------

async function scanViaMft({ drive, root, matches, onProgress, signal }) {
  const tree = await readVolumeTree(drive, { onProgress, signal });
  onProgress({ stage: "tree", count: tree.dirs.size });
  return buildHits({ ...tree, drive, root, matches });
}

/**
 * Read one volume's MFT and return its directory tree.
 *
 * Separate from scanVolume because sizing a known set of paths (the cache
 * tab) needs the same read but not the name matching. One sequential pass
 * over the MFT answers both questions.
 *
 * With a file-name query (see filenames.js), each file whose name matches
 * marks its parent directory, so a caller can ask "which folders hold a
 * Cargo.toml?" from the same read. Without one, files cost nothing extra.
 *
 * @param {string} drive e.g. "C:"
 * @param {{onProgress?: Function,
 *          query?: {exact: Set<string>, ext: Set<string>}|null,
 *          signal?: AbortSignal}} [opts]
 * @returns {Promise<{dirs: Map, ownBytes: Map, ownFiles: Map,
 *                    marks: Map<number, Set<string>>, drive: string}>}
 */
export async function readVolumeTree(
  drive,
  { onProgress = () => {}, query = null, signal } = {},
) {
  signal?.throwIfAborted();
  const handle = await fsp.open(`\\\\.\\${drive}`, "r");

  try {
    onProgress({ stage: "boot" });
    const boot = parseBootSector(await readAt(handle, 0n, 512));

    onProgress({ stage: "mft-header" });
    const zeroRecord = await readAt(
      handle,
      boot.mftOffset,
      boot.bytesPerFileRecord,
    );
    applyFixup(zeroRecord, boot.bytesPerSector);
    const ranges = runsToByteRanges(
      extractMftRuns(zeroRecord),
      boot.bytesPerCluster,
    );

    onProgress({ stage: "mft-stream" });
    const { dirs, ownBytes, ownFiles, marks } = await streamMftRecords({
      handle,
      ranges,
      boot,
      query,
      onProgress,
      signal,
    });

    return { dirs, ownBytes, ownFiles, marks, drive };
  } finally {
    await handle.close();
  }
}

/**
 * Read every MFT extent sequentially and parse the records within.
 *
 * Only directory records are retained. A volume with millions of files
 * cannot afford to hold a JS object per file — on this machine that came to
 * 1.3 GB of heap and killed the dev server. Files are folded into their
 * parent's running total as they stream past and then dropped, so peak
 * memory tracks the directory count rather than the file count.
 *
 * @returns {{dirs: Map<number, object>, ownBytes: Map<number, bigint>,
 *            ownFiles: Map<number, number>, marks: Map<number, Set<string>>}}
 */
async function streamMftRecords({ handle, ranges, boot, query, onProgress, signal }) {
  const recordSize = boot.bytesPerFileRecord;
  const dirs = new Map();
  const ownBytes = new Map();
  const ownFiles = new Map();
  const marks = new Map();

  let recordNumber = 0;
  let parsed = 0;
  let marked = 0;

  for (const range of ranges) {
    let consumed = 0n;

    while (consumed < range.length) {
      signal?.throwIfAborted();
      const remaining = range.length - consumed;
      const want = remaining < BigInt(READ_CHUNK) ? Number(remaining) : READ_CHUNK;
      const chunk = await readAt(handle, range.offset + consumed, want);
      if (chunk.length === 0) break;

      const usable = chunk.length - (chunk.length % recordSize);

      for (let off = 0; off + recordSize <= usable; off += recordSize) {
        const rec = chunk.subarray(off, off + recordSize);
        const current = recordNumber++;

        try {
          applyFixup(rec, boot.bytesPerSector);
        } catch {
          // A torn record on a live volume. Skip it rather than abort the
          // whole scan; one bad record costs us one file, not the run.
          continue;
        }

        const entry = parseFileRecord(rec, current);
        if (!entry) continue;

        if (entry.isDirectory) {
          dirs.set(current, entry);
        } else {
          // Fold into the parent's total, then let the record go.
          ownBytes.set(entry.parent, (ownBytes.get(entry.parent) ?? 0n) + entry.size);
          ownFiles.set(entry.parent, (ownFiles.get(entry.parent) ?? 0) + 1);

          if (query) {
            marked += markFile(marks, query, entry.name, entry.parent);
            if (marked > MAX_MARKS) {
              throw new Error(
                `file-name query marked more than ${MAX_MARKS.toLocaleString()} folders; a pack pattern is too broad`,
              );
            }
          }
        }

        if (++parsed % 50000 === 0) {
          onProgress({ stage: "mft-stream", count: parsed });
        }
      }

      consumed += BigInt(usable > 0 ? usable : chunk.length);
    }
  }

  return { dirs, ownBytes, ownFiles, marks };
}

function buildHits({ dirs, ownBytes, ownFiles, drive, root, matches }) {
  const wanted = normalize(root);
  const outermost = findOutermostMatches(dirs, matches);

  const resolved = [];
  for (const rec of outermost) {
    const full = resolvePath(dirs, rec, drive);
    if (!full) continue;
    if (!normalize(full).startsWith(wanted)) continue;
    resolved.push({ record: rec, path: full });
  }

  const totals = subtreeSizes(
    dirs,
    ownBytes,
    ownFiles,
    resolved.map((r) => r.record.recordNumber),
  );

  return resolved
    .map(({ record, path: full }) => {
      const total = totals.get(record.recordNumber) ?? { bytes: 0n, files: 0 };
      return {
        path: full,
        bytes: total.bytes.toString(),
        files: total.files,
        mtime: record.mtime ? record.mtime.toISOString() : null,
      };
    })
    .sort((a, b) => Number(BigInt(b.bytes) - BigInt(a.bytes)));
}

// ---------------------------------------------------------------------------
// Walk strategy
// ---------------------------------------------------------------------------

export async function scanViaWalk({ root, matches, onProgress = () => {}, signal }) {
  const found = [];
  let level = [root];
  let visited = 0;

  // Find every match first, then size them. Sizing is the expensive half and
  // is better done in one concurrent batch than interleaved with the walk.
  while (level.length > 0) {
    signal?.throwIfAborted();
    const reads = await Promise.all(level.map(readDirSafe));
    const next = [];

    for (const { dir, entries } of reads) {
      visited += 1;
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);

        if (matches(entry.name)) {
          // Prune: do not descend. A nested match lives inside this subtree
          // and is already covered by deleting this one.
          found.push(full);
        } else {
          next.push(full);
        }
      }
    }

    onProgress({ stage: "walk", count: visited });
    level = next;
  }

  onProgress({ stage: "sizing", count: found.length });

  const hits = [];
  for (const batch of chunk(found, 8)) {
    signal?.throwIfAborted();
    hits.push(...(await Promise.all(batch.map((dir) => measureSubtree(dir, signal)))));
    onProgress({ stage: "sizing", count: hits.length });
  }

  return hits.sort((a, b) => Number(BigInt(b.bytes) - BigInt(a.bytes)));
}

function* chunk(items, size) {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Total a subtree.
 *
 * A node_modules tree is tens of thousands of small files, and one awaited
 * stat per file is what makes a naive scan slow. Two things keep this quick:
 * directories are read a level at a time so sibling reads overlap, and the
 * stats for one directory's files are issued together rather than serially.
 */
async function measureSubtree(root, signal) {
  let bytes = 0n;
  let files = 0;
  let mtime = null;

  try {
    mtime = (await fsp.stat(root)).mtime.toISOString();
  } catch {
    /* keep null */
  }

  let level = [root];

  while (level.length > 0) {
    signal?.throwIfAborted();
    const reads = await Promise.all(level.map(readDirSafe));
    const next = [];
    const statJobs = [];

    for (const { dir, entries } of reads) {
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          next.push(full);
        } else if (entry.isFile()) {
          statJobs.push(sizeOf(full));
        }
      }
    }

    for (const size of await Promise.all(statJobs)) {
      if (size === null) continue;
      bytes += size;
      files += 1;
    }

    level = next;
  }

  return { path: root, bytes: bytes.toString(), files, mtime };
}

async function readDirSafe(dir) {
  try {
    return { dir, entries: await fsp.readdir(dir, { withFileTypes: true }) };
  } catch {
    return { dir, entries: [] };
  }
}

async function sizeOf(file) {
  try {
    return BigInt((await fsp.stat(file)).size);
  } catch {
    return null; // vanished mid-scan
  }
}

// ---------------------------------------------------------------------------

async function readAt(handle, offset, length) {
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buf, 0, length, Number(offset));
  return buf.subarray(0, bytesRead);
}

function driveLetterOf(root) {
  const match = /^([A-Za-z]:)/.exec(path.resolve(root));
  return match ? match[1].toUpperCase() : null;
}

function normalize(p) {
  return path.resolve(p).toLowerCase().replace(/\\+$/, "");
}

export { fs };
