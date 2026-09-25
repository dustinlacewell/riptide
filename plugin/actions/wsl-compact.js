/**
 * Compact WSL's virtual disks.
 *
 * A WSL disk (ext4.vhdx, Docker's docker_data.vhdx) grows as Linux writes
 * and never shrinks when it deletes. diskpart can compact it, but only
 * while nothing has it open, so WSL is shut down first.
 *
 * The disks are found on disk, never taken from a pack or a request:
 *
 *   %LOCALAPPDATA%\Packages\<distro>\LocalState\ext4.vhdx
 *   %LOCALAPPDATA%\Docker\wsl\**\*.vhdx
 *
 * diskpart reads its commands from stdin; nothing is written to disk. Each
 * disk path goes inside quotes in those commands, so a path that could
 * break out of them is refused. diskpart reads in the OEM code page, so
 * only printable ASCII is allowed.
 *
 * Fed on stdin, diskpart does not stop at an error and still exits 0, so
 * a step fails on diskpart's own error lines too.
 */

import fsp from "node:fs/promises";
import path from "node:path";

import { fileExists, system32 } from "./spawn.js";

const SHUTDOWN_TIMEOUT_MS = 2 * 60 * 1000;
const COMPACT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DETACH_TIMEOUT_MS = 5 * 60 * 1000;
const DOCKER_DEPTH = 4;
const DISKPART_ERROR = /DiskPart has encountered an error|Virtual Disk Service error|DiskPart failed/i;

export default {
  id: "wsl-compact",
  label: "WSL disks",
  tool: "wsl",
  risk: "caution",
  riskNote: "Shuts down WSL and Docker while it runs.",
  cost: "Nothing is lost. Each disk shrinks to what it holds.",

  async detect(ctx) {
    const { wsl, diskpart } = tools(ctx.env);
    if (!(await fileExists(wsl))) return { available: false, reason: "WSL not installed", bytes: null };
    if (!(await fileExists(diskpart))) return { available: false, reason: "diskpart.exe not found", bytes: null };
    if ((await findDisks(ctx.env)).length === 0) {
      return { available: false, reason: "no WSL disks found", bytes: null };
    }
    // What compacting frees depends on the free space inside each disk.
    return { available: true, bytes: null };
  },

  async steps(ctx) {
    const { wsl, diskpart } = tools(ctx.env);
    const disks = await findDisks(ctx.env);

    return [
      { exe: wsl, args: ["--shutdown"], timeoutMs: SHUTDOWN_TIMEOUT_MS },
      ...disks.map((disk) => ({
        exe: diskpart,
        args: [],
        timeoutMs: COMPACT_TIMEOUT_MS,
        label: `diskpart: compact ${disk}`,
        stdin: compactScript(disk),
        failPattern: DISKPART_ERROR,
        // Killing a compact midway can damage the disk.
        critical: true,
        // diskpart on stdin runs past an error, but a kill or a timeout
        // stops it with the disk still attached.
        cleanup: {
          exe: diskpart,
          args: [],
          timeoutMs: DETACH_TIMEOUT_MS,
          label: `diskpart: detach ${disk}`,
          stdin: detachScript(disk),
        },
      })),
    ];
  },
};

/**
 * The diskpart commands that compact one disk.
 *
 * @param {string} disk
 * @returns {string}
 */
export function compactScript(disk) {
  const problem = diskPathProblem(disk);
  if (problem) throw new Error(`refused disk path (${problem}): ${JSON.stringify(disk)}`);
  return [
    `select vdisk file="${disk}"`,
    "attach vdisk readonly",
    "compact vdisk",
    "detach vdisk",
    "exit",
    "",
  ].join("\r\n");
}

/**
 * The diskpart commands that detach one disk after a failed compact.
 * "noerr" keeps a disk that was never attached from counting as an error.
 *
 * @param {string} disk
 * @returns {string}
 */
export function detachScript(disk) {
  const problem = diskPathProblem(disk);
  if (problem) throw new Error(`refused disk path (${problem}): ${JSON.stringify(disk)}`);
  return [`select vdisk file="${disk}"`, "detach vdisk noerr", "exit", ""].join("\r\n");
}

/**
 * Why a path is not safe inside diskpart's quotes, or null when it is:
 * absolute on a drive, a .vhdx, printable ASCII only, no quote, no "..".
 *
 * The ASCII rule also shuts out every non-ASCII line break (U+0085,
 * U+2028) and curly quote.
 *
 * @param {unknown} p
 * @returns {string|null}
 */
export function diskPathProblem(p) {
  if (typeof p !== "string") return "not a string";
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(p)) return "path has non-ASCII characters";
  // Control characters are exactly what this refuses.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(p)) return "path has control characters";
  if (p.includes('"')) return "path has a quote";
  if (!/^[A-Za-z]:\\/.test(p)) return "not an absolute drive path";
  if (!/\.vhdx$/i.test(p)) return "not a .vhdx";
  if (p.split("\\").includes("..")) return "path has ..";
  return null;
}

/** @param {unknown} p */
export function isSafeDiskPath(p) {
  return diskPathProblem(p) === null;
}

/**
 * Every WSL disk on this machine that is safe to name in a script.
 *
 * @param {object} env
 * @returns {Promise<string[]>}
 */
export async function findDisks(env) {
  const local = env.LOCALAPPDATA;
  if (!local || !/^[A-Za-z]:\\/.test(local)) return [];

  const found = [
    ...(await distroDisks(path.win32.join(local, "Packages"))),
    ...(await vhdxUnder(path.win32.join(local, "Docker", "wsl"), DOCKER_DEPTH)),
  ];
  return found.filter(isSafeDiskPath);
}

// ---------------------------------------------------------------------------

function tools(env) {
  const dir = system32(env);
  return { wsl: path.win32.join(dir, "wsl.exe"), diskpart: path.win32.join(dir, "diskpart.exe") };
}

async function distroDisks(packages) {
  const disks = [];
  for (const pkg of await dirNames(packages)) {
    const disk = path.win32.join(packages, pkg, "LocalState", "ext4.vhdx");
    if (await fileExists(disk)) disks.push(disk);
  }
  return disks;
}

async function vhdxUnder(dir, depth) {
  let items;
  try {
    items = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const disks = [];
  for (const item of items) {
    const full = path.win32.join(dir, item.name);
    if (item.isFile() && /\.vhdx$/i.test(item.name)) disks.push(full);
    else if (item.isDirectory() && depth > 1) disks.push(...(await vhdxUnder(full, depth - 1)));
  }
  return disks;
}

async function dirNames(dir) {
  try {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    return items.filter((i) => i.isDirectory()).map((i) => i.name);
  } catch {
    return [];
  }
}
