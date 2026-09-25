/**
 * Session persistence for the search form.
 *
 * Only inputs are stored — root, patterns, sort. Scan results are
 * deliberately not persisted: they describe the disk at one moment, and
 * restoring a stale hit list invites deleting a path that has since moved
 * or grown. A rescan is cheap and always truthful.
 */

const KEY = "riptide.prefs.v1";

/** Tabs a stored preference may name. An unknown one falls back to default. */
const TABS = ["zap", "search", "caches"];

/** How many recently-picked roots to keep. Enough to cover a day's work. */
export const RECENT_LIMIT = 8;

/**
 * Put `root` at the front of `recent`, deduplicated and capped.
 *
 * Windows paths differ only by case, so the same folder picked twice must
 * not appear twice; the newest spelling is the one kept.
 */
export function remember(recent, root) {
  if (typeof root !== "string" || !root.trim()) return recent ?? [];

  const rest = (recent ?? []).filter((r) => r.toLowerCase() !== root.toLowerCase());
  return [root, ...rest].slice(0, RECENT_LIMIT);
}

/**
 * localStorage throws outright in some contexts (private windows, blocked
 * site data), so every access is guarded and a failure degrades to defaults
 * rather than breaking the page.
 */
/**
 * @param {{root: string, patterns: string, sort: object}} defaults
 * @param {string[]} sortKeys sort keys this build understands
 */
export function load(defaults, sortKeys) {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaults;
    return coerce(JSON.parse(raw), defaults, sortKeys);
  } catch {
    return defaults;
  }
}

export function save(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable or full — the app works without it */
  }
}

/**
 * Take only known fields of the right type. Stored JSON is whatever an older
 * build wrote, so it is treated as untrusted input rather than assumed to
 * match the current shape.
 */
function coerce(stored, defaults, sortKeys) {
  if (!stored || typeof stored !== "object") return defaults;

  const prefs = { ...defaults };

  for (const field of ["root", "patterns", "pattern", "globs"]) {
    if (typeof stored[field] === "string") prefs[field] = stored[field];
  }

  if (["smart", "sensitive", "insensitive"].includes(stored.caseMode)) {
    prefs.caseMode = stored.caseMode;
  }
  if (typeof stored.regex === "boolean") prefs.regex = stored.regex;

  // A stored list is whatever an older build wrote: take the strings, drop
  // the rest, and cap it so a corrupted entry cannot grow without bound.
  if (Array.isArray(stored.recentRoots)) {
    prefs.recentRoots = stored.recentRoots
      .filter((r) => typeof r === "string" && r.trim())
      .slice(0, RECENT_LIMIT);
  }

  // Disabled cache config ids. Unknown ids are harmless — a config removed
  // from a pack simply stops being referenced.
  if (Array.isArray(stored.disabledCaches)) {
    prefs.disabledCaches = stored.disabledCaches.filter(
      (id) => typeof id === "string" && id.trim(),
    );
  }

  if (Object.hasOwn(defaults, "tab") && TABS.includes(stored.tab)) {
    prefs.tab = stored.tab;
  }

  // A sort key from an older build may no longer exist. Falling back to the
  // default beats rendering a table sorted by nothing.
  const sort = stored.sort;
  if (
    sort &&
    sortKeys.includes(sort.key) &&
    (sort.direction === "asc" || sort.direction === "desc")
  ) {
    prefs.sort = { key: sort.key, direction: sort.direction };
  }

  return prefs;
}
