/**
 * docker image prune -f: remove dangling images only.
 *
 * `docker system df` reports what all unused images would free, not the
 * dangling ones alone, so the gain is unknown.
 */

import { dockerDf, findDocker } from "./docker.js";

const TIMEOUT_MS = 30 * 60 * 1000;

export default {
  id: "docker-image-prune",
  label: "Docker dangling images",
  tool: "docker",
  risk: "safe",
  cost: "Removes untagged images that no container uses.",

  async detect(ctx) {
    const df = await dockerDf(ctx);
    if (!df.available) return { available: false, reason: df.reason, bytes: null };
    return { available: true, bytes: null };
  },

  async steps(ctx) {
    const exe = (await findDocker(ctx.env)) ?? "docker";
    return [{ exe, args: ["image", "prune", "-f"], timeoutMs: TIMEOUT_MS }];
  },
};
