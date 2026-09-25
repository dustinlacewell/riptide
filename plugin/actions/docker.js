/**
 * What the docker actions share: finding the CLI, asking the daemon how
 * much space it holds, and reading Docker's size strings.
 */

import path from "node:path";

import { capture } from "./run.js";
import { fileExists, findExe } from "./spawn.js";

const PROBE_TIMEOUT_MS = 30 * 1000;

/**
 * Docker Desktop's own CLI first, then PATH. The server runs elevated, so
 * a docker.exe planted early on PATH should not win over the installed one.
 *
 * @returns {Promise<string|null>}
 */
export async function findDocker(env, { isFile = fileExists } = {}) {
  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? "C:\\Program Files";
  const installed = path.win32.join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe");
  if (await isFile(installed)) return installed;
  return findExe("docker", { env, isFile });
}

/**
 * `docker system df`, one row per kind of object. It needs the daemon, so
 * it also tells whether Docker is running.
 *
 * @returns {Promise<{available: boolean, reason?: string, rows: object[]}>}
 */
export async function dockerDf(ctx) {
  const exe = await findDocker(ctx.env);
  if (!exe) return { available: false, reason: "Docker not installed", rows: [] };

  const probe = await capture(ctx.spawn, {
    exe,
    args: ["system", "df", "--format", "json"],
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (!probe.ok) return { available: false, reason: "Docker is not running", rows: [] };
  return { available: true, rows: parseDfRows(probe.stdout) };
}

/** One JSON object per line; anything else is skipped. */
export function parseDfRows(lines) {
  const rows = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object") rows.push(row);
    } catch {
      /* not a row */
    }
  }
  return rows;
}

/**
 * A Docker size ("1.234GB", "800MB (45%)", "0B") as a decimal byte string.
 * Docker's units are powers of 1000.
 *
 * @param {unknown} text
 * @returns {string|null} null when it does not parse
 */
export function parseDockerSize(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKMGTP]?)B\b/.exec(String(text ?? ""));
  if (!m) return null;
  const power = { "": 0, k: 1, K: 1, M: 2, G: 3, T: 4, P: 5 }[m[2]];
  const [whole, frac = ""] = m[1].split(".");
  const digits = BigInt(whole + frac);
  const scaled = digits * 1000n ** BigInt(power);
  return (scaled / 10n ** BigInt(frac.length)).toString();
}
