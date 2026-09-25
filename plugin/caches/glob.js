/**
 * Name patterns for pack rules.
 *
 * A pattern matches one name, never a path: `*` is any run of characters,
 * `?` is one character, and case is ignored (NTFS names are
 * case-insensitive). There is no `**` and no separator handling.
 *
 * Patterns come from pack files, which are someone else's data, so a
 * pattern that would match nearly everything is refused rather than trusted.
 */

const MIN_LITERALS = 3;

/**
 * Compile a pattern to a predicate. Does not refuse broad patterns — that is
 * classifyName's job; a path segment may legitimately be a bare `*`.
 *
 * @param {string} pattern
 * @returns {(name: string) => boolean}
 */
export function compileGlob(pattern) {
  if (!hasWildcard(pattern)) {
    const lower = pattern.toLowerCase();
    return (name) => name.toLowerCase() === lower;
  }

  const source = [...pattern]
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : escape(ch)))
    .join("");
  const re = new RegExp(`^${source}$`, "is");
  return (name) => re.test(name);
}

/**
 * Classify a name pattern.
 *
 *   exact      no wildcards                 "Cargo.toml"
 *   extension  "*." then a literal suffix   "*.csproj"
 *   glob       any other wildcard use       "cmake-build-*"
 *   rejected   too broad to trust           "*", "*.h", "a*"
 *
 * @param {string} pattern
 * @returns {{kind: "exact"|"extension"|"glob"} | {kind: "rejected", reason: string}}
 */
export function classifyName(pattern) {
  if (typeof pattern !== "string" || pattern.trim() === "") {
    return { kind: "rejected", reason: "empty pattern" };
  }
  if (/[\\/]/.test(pattern)) {
    return { kind: "rejected", reason: `"${pattern}" is a path, not a name` };
  }
  if (!hasWildcard(pattern)) return { kind: "exact" };

  const literals = pattern.replace(/[*?]/g, "").length;
  if (literals < MIN_LITERALS) {
    return {
      kind: "rejected",
      reason: `"${pattern}" is too broad (needs ${MIN_LITERALS}+ literal characters)`,
    };
  }

  if (pattern.startsWith("*.") && !hasWildcard(pattern.slice(2))) {
    return { kind: "extension" };
  }
  return { kind: "glob" };
}

export function hasWildcard(text) {
  return /[*?]/.test(text);
}

function escape(ch) {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}
