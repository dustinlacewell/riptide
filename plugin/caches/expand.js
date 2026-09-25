/**
 * Expand environment variables and ~ in a pack path template.
 */

import path from "node:path";

/**
 * Returns null when a referenced variable is not set — that means the path
 * cannot apply to this machine, which is ordinary (a Linux path on Windows)
 * rather than an error.
 *
 * @param {string} template
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
export function expandPath(template, env = process.env) {
  if (typeof template !== "string" || template.trim() === "") return null;

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
 * "C:" for any path on drive C, else null.
 *
 * @param {string} full
 * @returns {string|null}
 */
export function driveOf(full) {
  const drive = full.slice(0, 2).toUpperCase();
  return /^[A-Z]:$/.test(drive) ? drive : null;
}
