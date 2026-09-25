/**
 * pnpm store prune: remove packages no project references from each pnpm
 * store on this machine.
 *
 * This is the right way to shrink a pnpm store. Deleting the store folder
 * leaves every project that links into it to be reinstalled.
 *
 * A store belongs to a drive, so a machine can have several. Each one is
 * pruned with --store-dir. The stores are found on disk: the one pnpm
 * reports, and the usual places (%LOCALAPPDATA%\pnpm\store, <drive>\.pnpm-store).
 *
 * pnpm is usually installed as pnpm.cmd, which needs a shell. So when there
 * is no pnpm.exe, pnpm's own script runs under this Node instead.
 */

import fsp from "node:fs/promises";
import path from "node:path";

import { capture } from "./run.js";
import { fileExists, findExe, onPath } from "./spawn.js";

const PRUNE_TIMEOUT_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20 * 1000;
const ON_A_DRIVE = /^[A-Za-z]:\\/;

export default {
  id: "pnpm-store-prune",
  label: "pnpm store prune",
  tool: "pnpm",
  risk: "safe",
  cost: "Unreferenced packages are re-downloaded if a project needs them again.",

  async detect(ctx) {
    const pnpm = await findPnpm(ctx.env);
    if (!pnpm) return { available: false, reason: "pnpm not found", bytes: null };
    const stores = await findStores(ctx, pnpm);
    if (stores.length === 0) return { available: false, reason: "no pnpm store found", bytes: null };
    // Prune removes only what nothing references; how much that is cannot
    // be known without doing it.
    return { available: true, bytes: null };
  },

  async steps(ctx) {
    const pnpm = (await findPnpm(ctx.env)) ?? { exe: "pnpm", args: [] };
    const stores = await findStores(ctx, pnpm);
    return stores.map((store) => ({
      exe: pnpm.exe,
      args: [...pnpm.args, "store", "prune", "--store-dir", store],
      timeoutMs: PRUNE_TIMEOUT_MS,
      label: `pnpm store prune --store-dir ${store}`,
    }));
  },
};

/**
 * How to start pnpm without a shell: pnpm.exe, or pnpm's script beside a
 * pnpm.cmd shim, run by this Node.
 *
 * @returns {Promise<{exe: string, args: string[]}|null>}
 */
export async function findPnpm(env, { isFile = fileExists, node = process.execPath } = {}) {
  const local = env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, "pnpm", "pnpm.exe")] : [];
  const exe = await findExe("pnpm", { env, known: local, isFile });
  if (exe) return { exe, args: [] };

  for (const shim of onPath("pnpm.cmd", env)) {
    const script = path.win32.join(path.win32.dirname(shim), "node_modules", "pnpm", "bin", "pnpm.cjs");
    if ((await isFile(shim)) && (await isFile(script))) return { exe: node, args: [script] };
  }
  return null;
}

/**
 * Store roots that exist, as --store-dir takes them (without the v3/v10
 * version folder pnpm adds).
 */
async function findStores(ctx, pnpm) {
  const candidates = [
    await reportedStore(ctx, pnpm),
    ctx.env.LOCALAPPDATA ? path.win32.join(ctx.env.LOCALAPPDATA, "pnpm", "store") : null,
    ctx.env.LOCALAPPDATA ? path.win32.join(ctx.env.LOCALAPPDATA, "pnpm-store") : null,
    ...(ctx.drives ?? []).map((drive) => path.win32.join(drive, ".pnpm-store")),
  ];

  const seen = new Set();
  const stores = [];
  for (const dir of candidates) {
    if (!dir || !ON_A_DRIVE.test(dir)) continue;
    const key = dir.toLowerCase();
    if (seen.has(key) || !(await dirExists(dir))) continue;
    seen.add(key);
    stores.push(dir);
  }
  return stores;
}

/** The store pnpm itself uses from here, from `pnpm store path`. */
async function reportedStore(ctx, pnpm) {
  if (!pnpm || !ctx.spawn) return null;
  const probe = await capture(ctx.spawn, {
    exe: pnpm.exe,
    args: [...pnpm.args, "store", "path"],
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const reported = probe.ok ? probe.stdout.at(-1)?.trim() : null;
  if (!reported || !ON_A_DRIVE.test(reported)) return null;
  // pnpm reports the versioned folder, D:\.pnpm-store\v10.
  return /^v\d+$/i.test(path.win32.basename(reported)) ? path.win32.dirname(reported) : reported;
}

async function dirExists(p) {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}
