/**
 * The action registry: cleanups done by a tool's own command rather than by
 * deleting a folder.
 *
 * A pack entry links to an action by id ("action": "<id>"). Packs never
 * hold commands; every command lives in the action's module, as a fixed
 * argv array. Adding an action means adding one module and one line below.
 *
 * Action interface:
 *
 *   { id, label, tool, risk: "safe"|"caution", riskNote?, cost,
 *     detect(ctx) -> Promise<{available, reason?, bytes: string|null}>,
 *     steps(ctx)  -> Promise<[{exe, args, timeoutMs, label?, writes?}]> }
 *
 *   ctx: {env, spawn, drives, tmpdir?}. detect may run read-only probes through ctx.spawn
 *   and stat known paths. bytes is a decimal string, or null when the
 *   command's gain cannot be known beforehand.
 */

import pnpmStorePrune from "./pnpm-store-prune.js";
import dockerBuilderPrune from "./docker-builder-prune.js";
import dockerImagePrune from "./docker-image-prune.js";
import wslCompact from "./wsl-compact.js";
import windowsComponentCleanup from "./windows-component-cleanup.js";

export const ACTIONS = [
  pnpmStorePrune,
  dockerBuilderPrune,
  dockerImagePrune,
  wslCompact,
  windowsComponentCleanup,
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/**
 * @param {string} id
 * @returns {object|null}
 */
export function actionFor(id) {
  return BY_ID.get(id) ?? null;
}
