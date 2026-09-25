/**
 * Fix an action's steps when its plan is made.
 *
 * The confirm dialog shows these steps, and the run executes exactly these
 * steps. Nothing is resolved again between the two: a disk that appears or
 * a store that moves after the plan is not run unseen.
 */

import { commandText } from "./run.js";

/**
 * @param {string[]} ids action ids already offered
 * @param {{actionFor: (id: string) => object|null, ctx: object}} deps
 * @returns {Promise<{bound: Array<{id: string, label: string, risk: string,
 *                                  steps: object[], commands: string[]}>,
 *                    refused: Array<{id: string, reason: string}>}>}
 */
export async function bindActions(ids, { actionFor, ctx }) {
  const bound = [];
  const refused = [];

  for (const id of ids) {
    const action = actionFor(id);
    if (!action) {
      refused.push({ id, reason: "unknown action" });
      continue;
    }
    let steps;
    try {
      steps = await action.steps(ctx);
    } catch (err) {
      refused.push({ id, reason: `could not prepare: ${err.message}` });
      continue;
    }
    if (steps.length === 0) {
      refused.push({ id, reason: "nothing to run" });
      continue;
    }
    bound.push({ id, label: action.label, risk: action.risk, steps, commands: steps.map(commandText) });
  }

  return { bound, refused };
}
