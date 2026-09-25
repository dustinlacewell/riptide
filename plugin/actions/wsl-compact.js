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
 * diskpart reads its commands from a script file, so each disk path is
 * written into one. A path that could break out of its quotes is refused.
 */

import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fileExists, system32 } from "./spawn.js";

const SHUTDOWN_TIMEOUT_MS = 2 * 60 * 1000;
const COMPACT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DOCKER_DEPTH = 4;

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
    const tmp = ctx.tmpdir ?? os.tmpdir();
    const disks = await findDisks(ctx.env);

    return [
      { exe: wsl, args: ["--shutdown"], timeoutMs: SHUTDOWN_TIMEOUT_MS },
      ...disks.map((disk) => {
        const script = path.win32.join(tmp, `riptide-compact-${randomUUID()}.txt`);
        return {
          exe: diskpart,
          args: ["/s", script],
          timeoutMs: COMPACT_TIMEOUT_MS,
          label: `diskpart: compact ${disk}`,
          writes: { path: script, text: compactScript(disk) },
        };
      }),
    ];
  },
};

/**
 * The diskpart script that compacts one disk.
 *
 * @param {string} disk
 * @returns {string}
 */
export function compactScript(disk) {
  if (!isSafeDiskPath(disk)) throw new Error(`refused disk path: ${JSON.stringify(disk)}`);
  return [
    `select vdisk file="${disk}"`,
    "attach vdisk readonly",
    "compact vdisk",
    "detach vdisk",
    "",
  ].join("\r\n");
}

/**
 * A path that is safe inside diskpart's quotes: absolute on a drive, a
 * .vhdx, and free of quotes, line breaks and other control characters.
 *
 * @param {unknown} p
 * @returns {boolean}
 */
export function isSafeDiskPath(p) {
  return (
    typeof p === "string" &&
    /^[A-Za-z]:\\/.test(p) &&
    /\.vhdx$/i.test(p) &&
    // Control characters are exactly what this refuses.
    // eslint-disable-next-line no-control-regex
    !/["\u0000-\u001f\u007f]/.test(p) &&
    !p.split("\\").includes("..")
  );
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
