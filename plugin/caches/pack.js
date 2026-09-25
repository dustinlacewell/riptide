/**
 * Cache pack loading and validation.
 *
 * A pack is a JSON file describing where tools keep their caches. Packs are
 * pure data — paths and prose, no commands — so loading one from someone
 * else's machine runs nothing.
 *
 * An entry is a few meta fields (id, label, tool, pack, cost, caution) plus
 * rules. Every other key names a matcher in matchers/index.js; an unknown
 * key is an error, not something to ignore, because a misspelt filter
 * ("besides") would otherwise silently widen what gets deleted.
 *
 * A key that is present must hold a usable value: `"beside": []` is an
 * error, not an absent filter.
 *
 * Each entry needs at least one locate rule (paths, drivePaths, dirNames).
 * Filter rules (under, beside, contains) narrow what those locate.
 */

import { matcherFor, MATCHERS } from "./matchers/index.js";

const META_KEYS = new Set(["id", "label", "tool", "pack", "cost", "caution"]);

/**
 * Validate a parsed pack.
 *
 * A pack is someone else's file, so a bad entry is reported and skipped
 * rather than failing the whole pack: one malformed line should not cost
 * the user every other cache in the file.
 *
 * @param {unknown} raw
 * @param {string} source where the pack came from, for error messages
 * @returns {{name: string, description: string,
 *            entries: object[], errors: Array<{entry: string, reason: string}>}}
 */
export function validatePack(raw, source = "pack") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source}: expected an object at the top level`);
  }

  // One cache per file is the normal shape, so a file may be the entry
  // itself. A file with an "entries" array holds several.
  if (!Array.isArray(raw.entries)) {
    if (typeof raw.id === "string") {
      raw = { name: raw.pack ?? source.replace(/\.json$/i, ""), entries: [raw] };
    } else {
      throw new Error(`${source}: needs an "id" or an "entries" array`);
    }
  }

  const packName = typeof raw.name === "string" ? raw.name : source;
  const entries = [];
  const errors = [];
  const seen = new Set();

  raw.entries.forEach((entry, index) => {
    const where = entry?.id ? String(entry.id) : `entry ${index}`;
    const result = parseEntry(entry, seen);

    if (result.error) {
      errors.push({ entry: where, reason: result.error });
      return;
    }

    seen.add(entry.id);
    entries.push({ ...result, pack: packName });
  });

  return {
    name: packName,
    description: typeof raw.description === "string" ? raw.description : "",
    entries,
    errors,
  };
}

/**
 * Human-readable description of each of an entry's rules, in registry order.
 *
 * @param {{match: Array<{key: string, spec: object}>}} entry
 * @returns {string[]}
 */
export function whereOf(entry) {
  return entry.match.map(({ key, spec }) => matcherFor(key).describe(spec));
}

// ---------------------------------------------------------------------------

function parseEntry(entry, seen) {
  const meta = metaProblem(entry, seen);
  if (meta) return { error: meta };

  const unknown = Object.keys(entry).find((k) => !META_KEYS.has(k) && !matcherFor(k));
  if (unknown) return { error: `unknown key "${unknown}"` };

  const match = [];
  for (const matcher of MATCHERS) {
    const value = entry[matcher.key];
    if (value === undefined) continue;

    const spec = matcher.parse(value);
    if (spec.error) return { error: spec.error };
    match.push({ key: matcher.key, spec });
  }

  const locators = match.map((m) => matcherFor(m.key)).filter((m) => m.role === "locate");
  if (locators.length === 0) {
    return { error: "no usable paths: needs paths, drivePaths or dirNames" };
  }

  const caution = typeof entry.caution === "string" && entry.caution.trim() ? entry.caution : null;

  return {
    id: entry.id,
    label: entry.label,
    tool: entry.tool ?? entry.id,
    cost: entry.cost ?? "",
    risk: caution ? "caution" : "safe",
    riskNote: caution,
    perProject: locators.some((m) => m.perProject),
    match,
  };
}

function metaProblem(entry, seen) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "not an object";
  if (!isNonEmptyString(entry.id)) return "missing id";
  if (seen.has(entry.id)) return "duplicate id";
  if (!isNonEmptyString(entry.label)) return "missing label";
  return null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
