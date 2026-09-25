/**
 * The last volume tree of each drive, held between requests.
 *
 *   get(drive, opts)   the drive's tree: {tree, how, changes, ms}
 *   peek(drive)        the tree held, without reading; null when none
 *   bytesPerDrive()    memory estimate from the last read, or null
 *
 * How many drives are held is the shared keep limit (keep.js). At 0
 * nothing is held and every get reads the whole MFT.
 *
 * One writer per drive: a get waits for the one before it on the same
 * drive, so two reads never race to replace a tree.
 *
 * Callers use a tree synchronously after get resolves. A later get may
 * replace it.
 */

import { createKeep, keyOf } from "../keep.js";
import { queryIds } from "./filenames.js";
import { driveBytes } from "./footprint.js";
import { readTreeFrom } from "./scan.js";
import { openVolume } from "./volume.js";

const now = () => performance.now();

/**
 * @param {{keep?: ReturnType<typeof createKeep>,
 *          open?: typeof openVolume, clock?: () => number}} [opts]
 *   open is injected so tests read a synthetic volume
 */
export function createTreeCache({ keep = createKeep(), open = openVolume, clock = now } = {}) {
  const held = new Map(); // drive -> tree
  const queues = new Map(); // drive -> tail of its get chain
  let lastBytes = null;

  keep.register({ holds: (drive) => held.has(drive), evict: (drive) => held.delete(drive) });

  /**
   * @param {string} drive e.g. "C:"
   * @param {{query?: object|null, signal?: AbortSignal,
   *          onProgress?: (n: object) => void, countMatch?: Function}} [opts]
   * @returns {Promise<{tree: object, how: "full", changes: number, ms: number}>}
   */
  function get(drive, opts = {}) {
    const key = keyOf(drive);
    const run = (queues.get(key) ?? Promise.resolve()).then(() => readFull(key, opts));
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  }

  async function readFull(key, { query = null, signal, onProgress, countMatch } = {}) {
    signal?.throwIfAborted();
    const started = clock();
    const volume = await open(key);
    try {
      const tree = await readTreeFrom(volume, key, { query, signal, onProgress, countMatch, clock });
      tree.queryIds = queryIds(query);
      lastBytes = driveBytes(tree);
      hold(key, tree);
      return { tree, how: "full", changes: 0, ms: clock() - started };
    } finally {
      await volume.close();
    }
  }

  function hold(key, tree) {
    held.set(key, tree);
    keep.touch(key);
  }

  return {
    get,
    peek: (drive) => held.get(keyOf(drive)) ?? null,
    bytesPerDrive: () => lastBytes,
  };
}

/**
 * A readTree for scan, caches and the map: the cached tree, with the
 * read's timing on it the way readVolumeTree reports it.
 *
 * @param {ReturnType<typeof createTreeCache>} cache
 * @param {{query?: object|null, full?: boolean}} [opts] query is the
 *        standing query, merged into every read's own; full skips any
 *        update and reads the whole MFT
 */
export function readerOf(cache, { query = null, full = false } = {}) {
  return async (drive, opts = {}) => {
    const { tree, how, changes, ms } = await cache.get(drive, {
      ...opts,
      full,
      query: mergeQueries(opts.query ?? null, query),
    });
    return { ...tree, readMs: ms, how, changes };
  };
}

/**
 * Both queries' names and extensions; null when both ask nothing.
 *
 * @param {{exact: Set<string>, ext: Set<string>}|null} a
 * @param {{exact: Set<string>, ext: Set<string>}|null} b
 */
export function mergeQueries(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { exact: new Set([...a.exact, ...b.exact]), ext: new Set([...a.ext, ...b.ext]) };
}
