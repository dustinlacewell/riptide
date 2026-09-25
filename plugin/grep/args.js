/**
 * Build the ripgrep argument list.
 *
 * Arguments are passed to spawn as an array, never joined into a shell
 * string, so a pattern containing quotes or semicolons is data rather than
 * syntax. Every value the user controls is a separate array element, and
 * "--" terminates option parsing so a pattern beginning with a dash cannot
 * become a flag.
 */

export const MAX_RESULTS = 5000;

/**
 * @param {{pattern: string, root: string, caseMode?: "smart"|"sensitive"|"insensitive",
 *          regex?: boolean, word?: boolean, hidden?: boolean, followSymlinks?: boolean,
 *          globs?: string[], maxResults?: number}} opts
 * @returns {string[]}
 */
export function buildArgs({
  pattern,
  root,
  caseMode = "smart",
  regex = true,
  word = false,
  hidden = false,
  followSymlinks = false,
  globs = [],
  maxResults = MAX_RESULTS,
}) {
  if (typeof pattern !== "string" || pattern === "") {
    throw new Error("pattern is required");
  }
  if (typeof root !== "string" || root === "") {
    throw new Error("root is required");
  }

  const args = ["--json"];

  switch (caseMode) {
    case "sensitive":
      args.push("--case-sensitive");
      break;
    case "insensitive":
      args.push("--ignore-case");
      break;
    default:
      args.push("--smart-case");
  }

  if (!regex) args.push("--fixed-strings");
  if (word) args.push("--word-regexp");
  if (hidden) args.push("--hidden");
  if (followSymlinks) args.push("--follow");

  // A runaway pattern can match millions of lines. Stop ripgrep itself
  // rather than trying to keep up downstream.
  args.push("--max-count", String(clampCount(maxResults)));

  for (const glob of globs) {
    if (typeof glob === "string" && glob.trim() !== "") {
      args.push("--glob", glob.trim());
    }
  }

  // Everything after "--" is a positional, so a pattern like "-foo" is
  // searched for instead of being read as a flag.
  args.push("--", pattern, root);

  return args;
}

/**
 * Split a comma-separated glob field into individual globs.
 */
export function parseGlobs(input) {
  if (Array.isArray(input)) return input.map(String);
  if (typeof input !== "string") return [];
  return input
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

function clampCount(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 1) return MAX_RESULTS;
  return Math.min(Math.floor(value), MAX_RESULTS);
}
