/**
 * Run ripgrep and stream grouped results.
 *
 * The imperative shell around the pure parsers in events.js.
 */

import { spawn, spawnSync } from "node:child_process";

import { buildArgs } from "./args.js";
import { interpret, createGrouper } from "./events.js";

const DEFAULT_MAX_FILES = 2000;

/**
 * Locate the ripgrep binary.
 *
 * PATH is tried first so a user's own install wins. Windows installers
 * update the registry, but a long-running process keeps the environment it
 * started with, so a freshly installed rg may not be on this process's PATH
 * yet — hence the known-location fallbacks.
 */
export function ripgrepCandidates(env = process.env) {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  return [
    "rg",
    env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\rg.exe` : null,
    home ? `${home}\\scoop\\shims\\rg.exe` : null,
    home ? `${home}\\.cargo\\bin\\rg.exe` : null,
    "C:\\ProgramData\\chocolatey\\bin\\rg.exe",
  ].filter(Boolean);
}

/**
 * @param {object} opts search options, as accepted by buildArgs
 * @param {{onGroup: (group: object) => void,
 *          onSummary?: (s: object) => void,
 *          maxFiles?: number,
 *          signal?: AbortSignal}} handlers
 * @returns {Promise<{files: number, truncated: boolean, elapsedMs: number}>}
 */
export function runRipgrep(opts, { onGroup, onSummary, maxFiles = DEFAULT_MAX_FILES, signal }) {
  const args = buildArgs(opts);

  return new Promise((resolve, reject) => {
    const child = spawnRipgrep(args);
    if (!child) {
      reject(new Error("ripgrep not found — install it and restart the dev server"));
      return;
    }

    const grouper = createGrouper();
    let files = 0;
    let truncated = false;
    let elapsedMs = 0;
    let buffer = "";
    let stderr = "";
    let settled = false;

    const stop = () => {
      if (!child.killed) child.kill();
    };
    signal?.addEventListener("abort", stop, { once: true });

    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue; // not a JSON line; ignore rather than abort the search
        }

        const note = interpret(event);
        if (note?.kind === "summary") {
          elapsedMs = note.elapsedMs;
          onSummary?.(note);
          continue;
        }

        const group = grouper.push(note);
        if (!group) continue;

        if (files >= maxFiles) {
          // Enough. Stop ripgrep rather than stream results nobody scrolls to.
          truncated = true;
          stop();
          break;
        }

        files += 1;
        onGroup(group);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", stop);

      // 0 = matches found, 1 = none, 2 = error. A kill for truncation or
      // abort leaves a null code, which is not a failure here.
      if (code === 2 && !truncated) {
        reject(new Error(stderr.trim() || "ripgrep failed"));
        return;
      }

      resolve({ files, truncated, elapsedMs });
    });
  });
}

let resolvedBinary;

/**
 * Find a working ripgrep once and remember it.
 *
 * spawn() reports a bad path asynchronously, so trying candidates by
 * spawning them would always "succeed" on the first. Each candidate is
 * probed synchronously with --version instead, and the winner is cached
 * for the life of the server.
 */
function resolveBinary() {
  if (resolvedBinary !== undefined) return resolvedBinary;

  for (const bin of ripgrepCandidates()) {
    const probe = spawnSync(bin, ["--version"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (!probe.error && probe.status === 0) {
      return (resolvedBinary = bin);
    }
  }

  return (resolvedBinary = null);
}

function spawnRipgrep(args) {
  const bin = resolveBinary();
  if (!bin) return null;
  return spawn(bin, args, { windowsHide: true });
}
