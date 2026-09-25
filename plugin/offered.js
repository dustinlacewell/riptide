/**
 * What the server has offered: paths for deletion, and actions to run.
 *
 * The server deletes only what one of its own scans found, and runs only
 * the actions its last cache scan found available. A client can ask for
 * anything; what no scan offered is refused before it can reach a plan.
 *
 * Each scan source ("zap", "caches", "map") owns its entries. A new scan of
 * a source clears that source's previous entries first, paths and actions
 * alike. Entries expire after a fixed time, so an old scan does not keep a
 * path deletable, or an action runnable, forever.
 */

import { pathKey } from "./pathKey.js";

const TTL_MS = 60 * 60 * 1000;

/**
 * @param {{now?: () => number, ttlMs?: number}} opts
 * @returns {{add: (paths: string[], source: string) => void,
 *            has: (path: string) => boolean,
 *            sourcesOf: (path: string) => string[],
 *            addActions: (ids: string[], source: string) => void,
 *            actionSourcesOf: (id: string) => string[],
 *            clear: (source: string) => void}}
 */
export function createOffered({ now = Date.now, ttlMs = TTL_MS } = {}) {
  const paths = createKeyed(pathKey, { now, ttlMs });
  const actions = createKeyed((id) => String(id), { now, ttlMs });
  // source -> pathKey -> the markers the path's rule needed next to it or
  // inside it (caches/verify.js), checked on disk again at plan time
  const markers = new Map();

  return {
    add: paths.add,
    has: (p) => paths.sourcesOf(p).length > 0,
    sourcesOf: paths.sourcesOf,
    addActions: actions.add,
    actionSourcesOf: actions.sourcesOf,

    /**
     * @param {string} path an offered path
     * @param {object[]} needs from markersOf in caches/verify.js
     * @param {string} source
     */
    addMarkers(path, needs, source) {
      if (needs.length === 0) return;
      if (!markers.has(source)) markers.set(source, new Map());
      markers.get(source).set(pathKey(path), needs);
    },

    /** Every marker any live source recorded for a path. */
    markersOf(path) {
      const live = paths.sourcesOf(path);
      return live.flatMap((source) => markers.get(source)?.get(pathKey(path)) ?? []);
    },

    clear(source) {
      paths.clear(source);
      actions.clear(source);
      markers.delete(source);
    },
  };
}

/** One namespace of offers: key -> Map<source, expiry>. */
function createKeyed(keyOf, { now, ttlMs }) {
  const entries = new Map();

  function add(items, source) {
    const expires = now() + ttlMs;
    for (const item of items) {
      const key = keyOf(item);
      if (!entries.has(key)) entries.set(key, new Map());
      entries.get(key).set(source, expires);
    }
  }

  // The sources that still offer an item. Expired entries are dropped.
  function sourcesOf(item) {
    const key = keyOf(item);
    const sources = entries.get(key);
    if (!sources) return [];
    const t = now();
    const live = [];
    for (const [source, expires] of sources) {
      if (expires > t) live.push(source);
      else sources.delete(source);
    }
    if (sources.size === 0) entries.delete(key);
    return live;
  }

  function clear(source) {
    for (const [key, sources] of entries) {
      sources.delete(source);
      if (sources.size === 0) entries.delete(key);
    }
  }

  return { add, sourcesOf, clear };
}
