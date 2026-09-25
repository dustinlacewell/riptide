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
 * Record a file's matches against its parent directory.
 *
 * @param {Map<number, Set<string>>} marks parent record number -> pattern ids
 * @param {{exact: Set<string>, ext: Set<string>}} query
 * @param {string} name the file's name
 * @param {number} parent the file's parent record number
 * @returns {number} how many new marks were added
 */
export function markFile(marks, query, name, parent) {
  const ids = matchName(query, name);
  if (ids.length === 0) return 0;

  let set = marks.get(parent);
  if (!set) marks.set(parent, (set = new Set()));

  let added = 0;
  for (const id of ids) {
    if (set.has(id)) continue;
    set.add(id);
    added += 1;
  }
  return added;
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
