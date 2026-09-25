/**
 * Result rows slide in when they first appear, top rows first. Only the
 * first 30 are staggered; the rest share the last delay, so a long list
 * does not trickle in for seconds.
 */

const STAGGER_MS = 15;
const STAGGERED = 30;

/** Animation delay, in ms, for the row at `index`. */
export function enterDelay(index) {
  return Math.min(index, STAGGERED - 1) * STAGGER_MS;
}
