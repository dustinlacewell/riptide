/**
 * Sorting for the results table.
 *
 * Sizes are BigInt strings because a node_modules tree can exceed the safe
 * integer range in aggregate; they are compared as BigInt, never coerced
 * through Number.
 */

export const COLUMNS = {
  path: { label: "Path", align: "left" },
  bytes: { label: "Size", align: "right" },
  files: { label: "Files", align: "right" },
  mtime: { label: "Modified", align: "right" },
};

/**
 * The Caches tab names a cache and where it is, not a path and a date. It
 * groups by rule, so Location carries an instance count for a rule that
 * matched many projects, and the path itself when it matched one.
 */
export const CACHE_GROUP_COLUMNS = {
  label: { label: "Cache", align: "left" },
  count: { label: "Location", align: "left" },
  bytes: { label: "Size", align: "right" },
  files: { label: "Files", align: "right" },
};

/** Which direction a column starts in when first clicked. */
const FIRST_DIRECTION = {
  path: "asc",
  label: "asc",
  count: "desc",
  bytes: "desc",
  files: "desc",
  mtime: "desc",
};

export const DEFAULT_SORT = { key: "bytes", direction: "desc" };

/**
 * Advance the sort state for a clicked column: a new column adopts its
 * natural first direction, the active column flips.
 */
export function nextSort(current, key) {
  if (current.key !== key) {
    return { key, direction: FIRST_DIRECTION[key] ?? "asc" };
  }
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/**
 * @param {Array<object>} hits
 * @param {{key: string, direction: "asc"|"desc"}} sort
 * @returns {Array<object>} a new sorted array
 */
export function sortHits(hits, sort) {
  const compare = COMPARATORS[sort.key] ?? COMPARATORS.bytes;
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...hits].sort((a, b) => sign * compare(a, b));
}

const COMPARATORS = {
  path: (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }),
  // Same label appears many times (one per project), so ties fall back to
  // size — the biggest instance of a cache is the one worth seeing first.
  label: (a, b) =>
    a.label.localeCompare(b.label) || cmpBigInt(BigInt(b.bytes), BigInt(a.bytes)),
  bytes: (a, b) => cmpBigInt(BigInt(a.bytes), BigInt(b.bytes)),
  files: (a, b) => a.files - b.files,
  // Missing timestamps sort oldest, so they never displace real dates.
  mtime: (a, b) => timeOf(a.mtime) - timeOf(b.mtime),
};

/** Shared so grouped sorting compares sizes the same way, as BigInt. */
export function cmpBigInt(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function timeOf(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}
