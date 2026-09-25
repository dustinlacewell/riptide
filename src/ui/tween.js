/**
 * Tween math, pure. The hook in useTween.js drives it from frames.
 */

/** Fast start, soft landing. */
export function easeOutCubic(k) {
  return 1 - (1 - k) ** 3;
}

/**
 * The value `elapsed` ms into a tween from `from` to `to`.
 *
 * @returns {number} exactly `to` once elapsed reaches duration
 */
export function tweenValue(from, to, elapsed, duration) {
  if (duration <= 0 || elapsed >= duration) return to;
  const k = Math.max(0, elapsed) / duration;
  return from + (to - from) * easeOutCubic(k);
}
