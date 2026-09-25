/**
 * The actions a cache scan lists: each linked pack entry, with whether its
 * action can run here, what it is expected to free, and the commands it
 * would run, as text.
 */

import { actionFor as registryLookup } from "./index.js";
import { commandText } from "./run.js";

/**
 * One row per action. Two entries that link the same action list it once,
 * under the first.
 *
 * Never rejects: an action whose detection throws is listed as unavailable
 * with the reason.
 *
 * @param {object[]} entries validated pack entries that carry `action`
 * @param {object} ctx the actions' ctx
 * @param {{actionFor?: (id: string) => object|null}} [deps]
 * @returns {Promise<object[]>}
 */
export async function listActions(entries, ctx, { actionFor = registryLookup } = {}) {
  const seen = new Set();
  const linked = [];
  for (const entry of entries) {
    const action = actionFor(entry.action);
    if (!action || seen.has(action.id)) continue;
    seen.add(action.id);
    linked.push({ entry, action });
  }
  return Promise.all(linked.map(({ entry, action }) => rowOf(entry, action, ctx)));
}

/**
 * The commands an action would run, as a person reads them.
 *
 * @returns {Promise<string[]>}
 */
export async function commandsOf(action, ctx) {
  try {
    return (await action.steps(ctx)).map(commandText);
  } catch {
    return [];
  }
}

async function rowOf(entry, action, ctx) {
  let found;
  try {
    found = await action.detect(ctx);
  } catch (err) {
    found = { available: false, reason: err.message, bytes: null };
  }

  return {
    id: entry.id,
    action: action.id,
    label: entry.label,
    tool: entry.tool,
    pack: entry.pack,
    cost: entry.cost,
    risk: entry.risk,
    riskNote: entry.riskNote,
    available: found.available === true,
    reason: found.available === true ? null : (found.reason ?? "not available"),
    bytes: typeof found.bytes === "string" ? found.bytes : null,
    commands: await commandsOf(action, ctx),
  };
}
