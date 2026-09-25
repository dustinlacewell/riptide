/**
 * Motion settings read from the page: the user's reduced-motion choice and
 * the duration tokens in tokens.css (which that choice already zeroes).
 */

/** True when the user asked for less motion. */
export function reducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A duration token in milliseconds, e.g. tokenMs("--t-surge") -> 600.
 * Falls back to `fallback` when the token is missing or unreadable.
 */
export function tokenMs(name, fallback = 0) {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ms = /^([\d.]+)ms$/.exec(raw);
  if (ms) return Number(ms[1]);
  const s = /^([\d.]+)s$/.exec(raw);
  return s ? Number(s[1]) * 1000 : fallback;
}
