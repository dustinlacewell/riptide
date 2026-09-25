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
    const sources = entries.get(pathKey(p));
    if (!sources) return false;
    const t = now();
    for (const [source, expires] of sources) {
      if (expires > t) return true;
      sources.delete(source);
    }
    entries.delete(pathKey(p));
    return false;
  }

  function clear(source) {
    for (const [key, sources] of entries) {
      sources.delete(source);
      if (sources.size === 0) entries.delete(key);
    }
  }

  return { add, has, clear };
}
