/**
 * How long a per-project cache's project has gone untouched.
 *
 * The server dates each per-project hit by its project (project:
 * {path, lastTouched}). Age is a readout, never a risk: it neither raises
 * nor lowers how dangerous a delete is. It drives one row note and one
 * filter.
 *
 * Pure: `now` is passed in.
 */

const DAY_MS = 86_400_000;

/** A project touched this recently is being worked on. */
export const IN_USE_DAYS = 7;

/** Thresholds the Untouched filter offers, in days. */
export const UNTOUCHED_CHOICES = [30, 90, 180, 365];
export const DEFAULT_UNTOUCHED = 90;

export const IN_USE_TEXT = "in use — rebuilds on next build";

/**
 * Whole days from `ms` to `now`, or null when there is no time.
 *
 * @param {number|null} ms Unix ms
 * @param {number} now Unix ms
 */
export function daysSince(ms, now) {
  if (ms === null || ms === undefined) return null;
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}

/** A day count, short: "12 d", "7 mo", "2 yr". */
export function ageText(days) {
  if (days < 30) return `${days} d`;
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  return `${Math.floor(days / 365)} yr`;
}

/**
 * The note a cache row shows for its project.
 *
 * @param {{path: string, lastTouched: number|null}|null|undefined} project
 * @param {number} now
 * @returns {{inUse: boolean, text: string}|null} null when the age is
 *          unknown: no project, or no dated file in it
 */
export function projectNote(project, now) {
  const days = daysSince(project?.lastTouched, now);
  if (days === null) return null;
  if (days < IN_USE_DAYS) return { inUse: true, text: IN_USE_TEXT };
  return { inUse: false, text: `untouched ${ageText(days)}` };
}

/**
 * Hits whose project has gone untouched for at least `days`. A hit of
 * unknown age is left out: an unknown age is not an old one.
 *
 * @param {object[]} hits
 * @param {number} days
 * @param {number} now
 */
export function untouchedFor(hits, days, now) {
  return hits.filter((hit) => (daysSince(hit.project?.lastTouched, now) ?? -1) >= days);
}
