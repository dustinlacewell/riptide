/**
 * Per-node flag bits in a map snapshot.
 *
 *   CACHE_SAFE     a cache entry with risk "safe" claimed this folder
 *   CACHE_CAUTION  a cache entry with any other risk claimed it
 *   NAME_HIT       its name matched one of the Zap tab's patterns
 *   REFUSED        a cache entry claimed it but the screen refused the path
 *   SYNTHETIC      not a real folder: the "(unreachable)" bucket
 *   REMOVED        deleted since the read; its bytes are gone from the totals
 */

export const CACHE_SAFE = 1;
export const CACHE_CAUTION = 2;
export const NAME_HIT = 4;
export const REFUSED = 8;
export const SYNTHETIC = 16;
export const REMOVED = 32;

const JUNK = CACHE_SAFE | CACHE_CAUTION | NAME_HIT;

/** @param {number} flags */
export function isJunk(flags) {
  return (flags & JUNK) !== 0;
}

/**
 * The client-facing name of a node's junk kind, or null.
 *
 * @param {number} flags
 * @returns {"cache-safe"|"cache-caution"|"name-hit"|"refused"|null}
 */
export function junkKind(flags) {
  if (flags & CACHE_SAFE) return "cache-safe";
  if (flags & CACHE_CAUTION) return "cache-caution";
  if (flags & NAME_HIT) return "name-hit";
  if (flags & REFUSED) return "refused";
  return null;
}
