/**
 * DISM component cleanup: remove superseded versions of Windows components
 * from the component store (WinSxS).
 */

import path from "node:path";

import { fileExists, system32 } from "./spawn.js";

const TIMEOUT_MS = 2 * 60 * 60 * 1000;

export default {
  id: "windows-component-cleanup",
  label: "Windows component store",
  tool: "windows",
  risk: "caution",
  riskNote: "Slow. Old updates can no longer be uninstalled.",
  cost: "Removes superseded Windows component versions.",

  async detect(ctx) {
    if (!(await fileExists(dismPath(ctx.env)))) {
      return { available: false, reason: "dism.exe not found", bytes: null };
    }
    return { available: true, bytes: null };
  },

  async steps(ctx) {
    return [
      {
        exe: dismPath(ctx.env),
        args: ["/Online", "/Cleanup-Image", "/StartComponentCleanup"],
        timeoutMs: TIMEOUT_MS,
        // Killing DISM midway can leave the component store damaged.
        critical: true,
      },
    ];
  },
};

function dismPath(env) {
  return path.win32.join(system32(env), "Dism.exe");
}
