/**
 * How actions start processes, and how they find the programs they start.
 *
 * Every action command is a fixed argv array in code. It is spawned without
 * a shell, so no argument is ever parsed as shell syntax. Batch files
 * (.cmd, .bat) need cmd.exe to run, so they are refused outright.
 */

import { spawn as nodeSpawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

const OPTIONS = {
  shell: false,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
};

/**
 * @param {typeof nodeSpawn} [spawnImpl] the seam for tests
 * @param {object} [env]
 * @returns {(exe: string, args: string[]) => import("node:child_process").ChildProcess}
 */
export function createSpawner(spawnImpl = nodeSpawn, env = process.env) {
  return (exe, args) => {
    if (typeof exe !== "string" || exe === "") throw new TypeError("exe must be a string");
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
      throw new TypeError("args must be an array of strings");
    }
    if (/\.(?:cmd|bat)$/i.test(exe)) throw new Error("batch files need a shell and are not run");
    // wsl.exe writes UTF-16 unless told otherwise.
    return spawnImpl(exe, args, { ...OPTIONS, env: { ...env, WSL_UTF8: "1" } });
  };
}

/**
 * Find `<name>.exe` on PATH, then at the known locations, in order.
 *
 * Only absolute PATH entries count: a relative one would resolve against
 * the server's working directory.
 *
 * @param {string} name without extension
 * @param {{env: object, known?: string[], isFile?: (p: string) => Promise<boolean>}} opts
 * @returns {Promise<string|null>}
 */
export async function findExe(name, { env, known = [], isFile = fileExists }) {
  for (const candidate of [...onPath(`${name}.exe`, env), ...known]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Every absolute PATH directory joined with a file name.
 *
 * @param {string} file
 * @param {object} env
 * @returns {string[]}
 */
export function onPath(file, env) {
  const raw = env.PATH ?? env.Path ?? "";
  return raw
    .split(";")
    .map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
    .filter((dir) => /^[A-Za-z]:\\/.test(dir))
    .map((dir) => path.win32.join(dir, file));
}

/** The Windows system folder, e.g. C:\Windows\System32. */
export function system32(env) {
  return path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32");
}

export async function fileExists(p) {
  try {
    return (await fsp.stat(p)).isFile();
  } catch {
    return false;
  }
}
