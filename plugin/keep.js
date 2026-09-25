/**
 * How many drives the server keeps ready between requests: one limit that
 * every per-drive store shares.
 *
 * The tree cache and the space-map snapshots each hold something per
 * drive. The user sets one number (0-3); the drives used most recently are
 * the ones kept, and a drive that falls out is evicted from every store at
 * once.
 *
 * A store may ask for a floor: the space map cannot show a page without its
 * snapshot, so it keeps its own most recent drive even when that drive is
 * past the limit.
 */

export const KEEP_CHOICES = [0, 1, 2, 3];
export const DEFAULT_KEEP = 2;

/**
 * @param {{limit?: number}} [opts]
 */
export function createKeep({ limit = DEFAULT_KEEP } = {}) {
  let current = checkLimit(limit);
  const order = []; // drive keys, most recent last
  const stores = new Set();

  const newest = (list, n) => (n > 0 ? list.slice(-n) : []);

  function apply() {
    const kept = new Set(newest(order, current));
    const survivors = new Set(kept);
    for (const store of stores) {
      const own = new Set([...kept, ...newest(order.filter(store.holds), store.floor)]);
      for (const drive of order) if (!own.has(drive)) store.evict(drive);
      for (const drive of own) survivors.add(drive);
    }
    for (let i = order.length - 1; i >= 0; i--) if (!survivors.has(order[i])) order.splice(i, 1);
  }

  return {
    get limit() {
      return current;
    },

    /** Change the limit; drives past it are evicted now. */
    setLimit(next) {
      current = checkLimit(next);
      apply();
    },

    /** A store just used or filled this drive. */
    touch(drive) {
      const key = keyOf(drive);
      const at = order.indexOf(key);
      if (at >= 0) order.splice(at, 1);
      order.push(key);
      apply();
    },

    /**
     * @param {{evict: (drive: string) => void, holds: (drive: string) => boolean,
     *          floor?: number}} store
     * @returns {() => void} unregister
     */
    register({ evict, holds, floor = 0 }) {
      const store = { evict, holds, floor };
      stores.add(store);
      return () => stores.delete(store);
    },
  };
}

/** "C:" from "c:\\anything". */
export function keyOf(drive) {
  return String(drive).slice(0, 2).toUpperCase();
}

function checkLimit(n) {
  if (!KEEP_CHOICES.includes(n)) throw new Error(`keep must be one of ${KEEP_CHOICES.join(", ")}`);
  return n;
}
