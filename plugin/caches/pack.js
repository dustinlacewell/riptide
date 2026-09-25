/**
 * Cache pack loading and validation.
 *
 * A pack is a JSON file describing where tools keep their caches. Packs are
 * pure data — paths and prose, no commands — so loading one from someone
 * else's machine runs nothing.
 *
 * Three kinds of location:
 *
 *   paths       absolute once expanded ("%LOCALAPPDATA%\\pnpm\\store",
 *               "~/.cargo/registry"). Resolved once.
 *   drivePaths  anchored to a drive root ("\\.pnpm-store"). Checked against
 *               every drive, since a store may live on any of them.
 *   dirNames    a directory name that appears inside projects rather than at
 *               a fixed location (".vite", "target", ".next"). Found by name
 *               in the same MFT read that sizes everything else, so it costs
 *               nothing extra.
 *
 * A dirName entry may set `under` to require a parent directory name — Vite's
 * cache is "node_modules/.vite", so `{ dirNames: [".vite"], under: "node_modules" }`
 * will not match a stray .vite elsewhere.
 */

import path from "node:path";

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

  const entries = [];
  const errors = [];
  const seen = new Set();

  raw.entries.forEach((entry, index) => {
    const where = entry?.id ? String(entry.id) : `entry ${index}`;
    const problem = entryProblem(entry, seen);

    if (problem) {
      errors.push({ entry: where, reason: problem });
      return;
    }

    seen.add(entry.id);
    entries.push({
      id: entry.id,
      label: entry.label,
      tool: entry.tool ?? entry.id,
      paths: (entry.paths ?? []).filter(isNonEmptyString),
      drivePaths: (entry.drivePaths ?? []).filter(isNonEmptyString),
      dirNames: (entry.dirNames ?? []).filter(isNonEmptyString),
      under: isNonEmptyString(entry.under) ? entry.under : null,
      cost: entry.cost ?? "",
      caution: entry.caution ?? null,
      pack: typeof raw.name === "string" ? raw.name : source,
    });
  });

  return {
    name: typeof raw.name === "string" ? raw.name : source,
    description: typeof raw.description === "string" ? raw.description : "",
    entries,
    errors,
  };
}

function entryProblem(entry, seen) {
  if (!entry || typeof entry !== "object") return "not an object";
  if (!isNonEmptyString(entry.id)) return "missing id";
  if (seen.has(entry.id)) return "duplicate id";
  if (!isNonEmptyString(entry.label)) return "missing label";

  const paths = entry.paths ?? [];
  const drivePaths = entry.drivePaths ?? [];
  const dirNames = entry.dirNames ?? [];

  if (!Array.isArray(paths) || !Array.isArray(drivePaths) || !Array.isArray(dirNames)) {
    return "paths, drivePaths and dirNames must be arrays";
  }
  if (
    paths.filter(isNonEmptyString).length === 0 &&
    drivePaths.filter(isNonEmptyString).length === 0 &&
    dirNames.filter(isNonEmptyString).length === 0
  ) {
    return "no usable paths";
  }
  return null;
}

/**
 * Expand environment variables and ~ in a path template.
 *
 * Returns null when a referenced variable is not set — that means the path
 * cannot apply to this machine, which is ordinary (a Linux path on Windows)
 * rather than an error.
 *
 * @param {string} template
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
export function expandPath(template, env = process.env) {
  if (!isNonEmptyString(template)) return null;

  let out = template;

  if (out.startsWith("~/") || out.startsWith("~\\")) {
    const home = env.USERPROFILE ?? env.HOME;
    if (!home) return null;
    out = path.join(home, out.slice(2));
  }

  // %VAR% (Windows) and $VAR / ${VAR} (POSIX-style, for shared packs).
  let missing = false;
  out = out
    .replace(/%([^%]+)%/g, (_, name) => {
      const value = env[name];
      if (value === undefined) missing = true;
      return value ?? "";
    })
    .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name) => {
      const value = env[name];
      if (value === undefined) missing = true;
      return value ?? "";
    });

  if (missing) return null;

  return path.normalize(out);
}

/**
 * Every absolute path an entry could occupy on this machine.
 *
 * @param {object} entry a validated entry
 * @param {string[]} drives e.g. ["C:\\", "D:\\"]
 * @param {Record<string, string|undefined>} env
 * @returns {string[]}
 */
export function candidatePaths(entry, drives, env = process.env) {
  const out = [];

  for (const template of entry.paths) {
    const expanded = expandPath(template, env);
    if (expanded && path.isAbsolute(expanded)) out.push(expanded);
  }

  // A drive-relative path may exist on any volume, so try them all.
  for (const template of entry.drivePaths) {
    const relative = template.replace(/^[\\/]+/, "");
    if (!relative) continue;
    for (const drive of drives) {
      out.push(path.join(drive, relative));
    }
  }

  // Two templates can expand to the same place on one machine.
  const seen = new Set();
  return out.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
