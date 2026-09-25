/**
 * File-name queries for the MFT stream.
 *
 * File records are dropped as they stream past, so a question about files
 * ("is there a Cargo.toml in this folder?") must be asked during the read.
 * A query is a set of exact names and a set of extensions; each file name is
 * tested against both, and a hit is recorded against the file's parent
 * directory as the pattern's id.
 *
 * Only two pattern shapes are supported, because both are Set lookups:
 *
 *   exact      "Cargo.toml"
 *   extension  "*.csproj"
 *
 * A pattern's id is its lowercased text, so a caller can test a mark with
 * the same string it asked for.
 */

import { createBitset } from "./bitset.js";

/**
 * @param {string[]} patterns
 * @returns {{exact: Set<string>, ext: Set<string>}|null} null when there is
 *          nothing to ask, so the stream can skip the test entirely
 */
export function buildNameQuery(patterns) {
  const exact = new Set();
  const ext = new Set();

  for (const pattern of patterns) {
    const lower = pattern.toLowerCase();
    if (isExtension(lower)) {
      ext.add(lower.slice(1)); // ".csproj"
    } else if (!/[*?]/.test(lower)) {
      exact.add(lower);
    } else {
      throw new Error(`unsupported file pattern "${pattern}": use a name or *.ext`);
    }
  }

  if (exact.size === 0 && ext.size === 0) return null;
  return { exact, ext };
}

/**
 * Pattern ids a file name satisfies.
 *
 * Every dot is tried as an extension start, so "*.tar.gz" matches
 * "a.tar.gz" as well as "*.gz" does.
 *
 * @param {{exact: Set<string>, ext: Set<string>}} query
 * @param {string} name
 * @returns {string[]}
 */
export function matchName(query, name) {
  const lower = name.toLowerCase();
  const ids = [];

  if (query.exact.has(lower)) ids.push(lower);

  if (query.ext.size > 0) {
    for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
      const suffix = lower.slice(dot);
      if (query.ext.has(suffix)) ids.push("*" + suffix);
    }
  }

  return ids;
}

/**
 * The pattern ids a query can produce.
 *
 * @param {{exact: Set<string>, ext: Set<string>}|null} query
 * @returns {string[]}
 */
export function queryIds(query) {
  if (!query) return [];
  return [...query.exact, ...[...query.ext].map((suffix) => "*" + suffix)];
}

/**
 * @typedef {{ids: string[],
 *            has: (dir: number, id: string) => boolean,
 *            count: (dir: number, id: string) => number,
 *            set: (dir: number, id: string) => void,
 *            unset: (dir: number, id: string) => void,
 *            readonly bytes: number}} Marks
 */

/**
 * How many files matching each pattern every directory holds.
 *
 * A mark is a count, not a flag, so a file leaving a folder can take its
 * mark away without hiding a sibling that matches the same pattern. Most
 * folders hold one match at most, so each pattern is a bitset (one or more)
 * plus a Map for only the folders that hold two or more. Memory is about
 * one bit per record per pattern; a 4.87M-record volume with 17 patterns
 * costs about 10 MB, plus the rare multi-match folders.
 *
 * @param {string[]} ids pattern ids (see markId)
 * @param {number} [size] record count, to reserve the bits up front
 * @returns {Marks}
 */
export function createMarks(ids, size = 0) {
  const byId = new Map(ids.map((id) => [id, { bits: createBitset(size), more: new Map() }]));
  const tallyOf = (id) => {
    const tally = byId.get(id);
    if (!tally) throw new Error(`mark for unknown pattern "${id}"`);
    return tally;
  };

  return {
    ids,
    has: (dir, id) => byId.get(id)?.bits.has(dir) ?? false,
    count(dir, id) {
      const tally = byId.get(id);
      if (!tally?.bits.has(dir)) return 0;
      return tally.more.get(dir) ?? 1;
    },
    set(dir, id) {
      const { bits, more } = tallyOf(id);
      if (!bits.has(dir)) bits.set(dir);
      else more.set(dir, (more.get(dir) ?? 1) + 1);
    },
    unset(dir, id) {
      const { bits, more } = tallyOf(id);
      const held = more.get(dir);
      if (held === undefined) bits.clear(dir);
      else if (held > 2) more.set(dir, held - 1);
      else more.delete(dir);
    },
    get bytes() {
      let sum = 0;
      for (const { bits, more } of byId.values()) sum += bits.bytes + more.size * MAP_ENTRY_BYTES;
      return sum;
    },
  };
}

// A Map entry of two small integers, as V8 lays it out: key, value, chain
// link and a share of the bucket table.
const MAP_ENTRY_BYTES = 20;

/**
 * Record a file's matches against its parent directory.
 *
 * @param {Marks} marks
 * @param {{exact: Set<string>, ext: Set<string>}} query
 * @param {string} name the file's name
 * @param {number} parent the file's parent record number
 * @returns {string[]} the ids marked
 */
export function markFile(marks, query, name, parent) {
  const ids = matchName(query, name);
  for (const id of ids) marks.set(parent, id);
  return ids;
}

/**
 * The id a pattern's marks are stored under.
 *
 * @param {string} pattern
 * @returns {string}
 */
export function markId(pattern) {
  return pattern.toLowerCase();
}

function isExtension(lower) {
  return lower.startsWith("*.") && !/[*?]/.test(lower.slice(2)) && lower.length > 2;
}
