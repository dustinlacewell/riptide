/**
 * Which actions are running now. One action runs at most once at a time:
 * two DISM cleanups, or two compacts of one disk, must never overlap.
 *
 * @returns {{take: (id: string) => boolean, release: (id: string) => void}}
 */
export function createRunLock() {
  const running = new Set();
  return {
    // False when the id is already held.
    take(id) {
      if (running.has(id)) return false;
      running.add(id);
      return true;
    },
    release(id) {
      running.delete(id);
    },
  };
}
