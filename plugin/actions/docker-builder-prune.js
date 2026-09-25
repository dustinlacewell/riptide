/**
 * docker builder prune -f: remove dangling build cache.
 */

import { dockerDf, findDocker, parseDockerSize } from "./docker.js";

const TIMEOUT_MS = 30 * 60 * 1000;

export default {
  id: "docker-builder-prune",
  label: "Docker build cache",
  tool: "docker",
  risk: "safe",
  cost: "The next build redoes the removed layers.",

  async detect(ctx) {
    const df = await dockerDf(ctx);
    if (!df.available) return { available: false, reason: df.reason, bytes: null };
    const row = df.rows.find((r) => r.Type === "Build Cache");
    return { available: true, bytes: row ? parseDockerSize(row.Reclaimable) : null };
  },

  async steps(ctx) {
    const exe = (await findDocker(ctx.env)) ?? "docker";
    return [{ exe, args: ["builder", "prune", "-f"], timeoutMs: TIMEOUT_MS }];
  },
};
