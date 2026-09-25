/**
 * The paths the server has offered for deletion.
 *
 * The server deletes only what one of its own scans found. A client can ask
 * for any path; a path no scan offered is refused before it can reach a plan.
 *
 * Each scan source ("zap", "caches") owns its entries. A new scan of a source
 * clears that source's previous entries first. Entries expire after a fixed
 * time, so an old scan does not keep a path deletable forever.
 */

import { pathKey } from "./pathKey.js";

const TTL_MS = 60 * 60 * 1000;

/**
 * @param {{now?: () => number, ttlMs?: number}} opts
 * @returns {{add: (paths: string[], source: string) => void,
 *            has: (path: string) => boolean,
 *            sourcesOf: (path: string) => string[],
 *            clear: (source: string) => void}}
 */
export function createOffered({ now = Date.now, ttlMs = TTL_MS } = {}) {
  // key -> Map<source, expiry>
  const entries = new Map();

  function add(paths, source) {
    const expires = now() + ttlMs;
    for (const p of paths) {
      const key = pathKey(p);
      if (!entries.has(key)) entries.set(key, new Map());
      entries.get(key).set(source, expires);
    }
  }

  function has(p) {
    return sourcesOf(p).length > 0;
  }

  // The sources that still offer a path. Expired entries are dropped.
  function sourcesOf(p) {
    const key = pathKey(p);
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

  return { add, has, sourcesOf, clear };
}
