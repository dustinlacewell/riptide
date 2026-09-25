/**
 * The space-map snapshots the server holds between requests.
 *
 * One slot per drive: {snap, gen, readAt, recordsTotal}. A slot changes only
 * when a read completes, so a stopped or failed read leaves the previous
 * snapshot in place. A new read of a drive stops the one still running on
 * it. How many drives are held is the shared keep limit (keep.js), with a
 * floor of one: the map cannot show a page without its snapshot. The least
 * recently used drive goes first. Slots do not expire.
 *
 * Every snapshot and every change to one gets a fresh generation number
 * from one counter. A client that asks with an old number gets told so,
 * rather than reading ids from a different snapshot.
 */

import { createKeep, keyOf } from "../keep.js";
import { applyChanges } from "./compact.js";
import { idOfPath } from "./page.js";

/**
 * @param {{keep?: ReturnType<typeof createKeep>, now?: () => number}} [opts]
 */
export function createMapStore({ keep = createKeep(), now = Date.now } = {}) {
  const slots = new Map();
  const running = new Map();
  let counter = 0;
  keep.register({ floor: 1, holds: (drive) => slots.has(drive), evict: (drive) => slots.delete(drive) });

  /**
   * Start a read of a drive. Any read already running on it is stopped.
   *
   * @param {string} drive e.g. "C:"
   * @param {AbortSignal} [outer] the request's own signal
   * @returns {{signal: AbortSignal, end: () => void}} call end() when the
   *          read finishes, however it finishes
   */
  function begin(drive, outer) {
    const key = keyOf(drive);
    running.get(key)?.abort();
    const controller = new AbortController();
    running.set(key, controller);
    const signal = outer ? AbortSignal.any([outer, controller.signal]) : controller.signal;
    const end = () => {
      if (running.get(key) === controller) running.delete(key);
    };
    return { signal, end };
  }

  /** Hold a completed snapshot. Returns its slot. */
  function publish(drive, snap, { recordsTotal = 0 } = {}) {
    const key = keyOf(drive);
    snap.gen = ++counter;
    // `read` names the snapshot; `gen` also moves when a delete changes it.
    // Ids stay valid while `read` is the same.
    const slot = { drive: key, snap, gen: snap.gen, read: snap.gen, readAt: now(), recordsTotal };
    slots.set(key, slot);
    keep.touch(key);
    return slot;
  }

  /** The slot for a drive, or null. Counts as a use. */
  function get(drive) {
    const key = keyOf(drive);
    const slot = slots.get(key);
    if (!slot) return null;
    keep.touch(key);
    return slot;
  }

  /**
   * The slot for a drive at a generation.
   *
   * @returns {{slot: object|null, stale: object|null}} stale, when the
   *          drive is held at another generation, is that slot
   */
  function at(drive, gen) {
    const slot = get(drive);
    if (!slot) return { slot: null, stale: null };
    if (slot.gen !== Number(gen)) return { slot: null, stale: slot };
    return { slot, stale: null };
  }

  /**
   * Take deleted folders out of every held snapshot that contains them.
   *
   * @param {string[]} paths absolute paths that were deleted
   */
  function removePaths(paths) {
    for (const slot of slots.values()) {
      const removed = [];
      for (const full of paths) {
        if (keyOf(full.slice(0, 2)) !== slot.drive) continue;
        const id = idOfPath(slot.snap, full);
        if (id > 0) removed.push(slot.snap.recNo[id]);
      }
      if (removed.length === 0) continue;
      applyChanges(slot.snap, { removed, gen: ++counter });
      slot.gen = slot.snap.gen;
    }
  }

  return { begin, publish, get, at, removePaths };
}
