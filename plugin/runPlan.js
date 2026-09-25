/**
 * Carry out a confirmed plan: delete its paths, then run its actions one at
 * a time.
 *
 * Paths go first, all together, as they always have. Actions follow in plan
 * order; each one's output lines are passed on as it runs. Actions ignore
 * "permanent": a command has no Recycle Bin.
 *
 * Every note goes through `write`:
 *
 *   {type: "progress", path, ok, error?, done, total}   one per path
 *   {type: "action", id, status: "running"}
 *   {type: "action", id, step, critical}               a step starts
 *   {type: "action", id, line}                         output
 *   {type: "action", id, status: "ok"|"failed", error?}
 *
 * The I/O is injected, so this is testable without deleting or running
 * anything.
 *
 * An action item carries the steps bound when the plan was made (see
 * actions/bind.js). Those run, exactly; the action's own steps() is never
 * asked again. Only its preflight check comes from the registry.
 *
 * @param {Array<{kind: "path", path: string}|
 *               {kind: "action", id: string, steps: object[]}>} items
 * @param {{permanent: boolean, signal?: AbortSignal, write: (note: object) => void,
 *          zapPaths: Function, runAction: Function,
 *          actionFor: (id: string) => object|null, ctx: object,
 *          lock: ReturnType<import("./actions/lock.js").createRunLock>}} deps
 *   lock is shared by every run: an action already running in another
 *   run fails here with "already running"
 * @returns {Promise<{deleted: string[], failed: object[],
 *                    actions: Array<{id: string, ok: boolean, error?: string}>}>}
 */
export async function runPlan(items, deps) {
  const paths = items.filter((i) => i.kind === "path").map((i) => i.path);
  const bound = items.filter((i) => i.kind === "action");

  const results = paths.length > 0 ? await deletePaths(paths, deps) : [];
  const actions = [];
  for (const item of bound) actions.push(await runOne(item, deps));

  return {
    deleted: results.filter((r) => r.ok).map((r) => r.path),
    failed: results.filter((r) => !r.ok),
    actions,
  };
}

function deletePaths(paths, { permanent, write, zapPaths }) {
  return zapPaths(paths, {
    permanent,
    onProgress: (note) => write({ type: "progress", ...note }),
  });
}

async function runOne(item, deps) {
  const { id } = item;
  const problem = problemOf(item, deps);
  if (problem) {
    deps.write({ type: "action", id, status: "failed", error: problem });
    return { id, ok: false, error: problem };
  }
  try {
    return await runLocked(item, deps);
  } finally {
    deps.lock.release(id);
  }
}

/** Why an item cannot start; taking the lock when it can. */
function problemOf({ id, steps }, { actionFor, lock }) {
  if (!actionFor(id)) return "unknown action";
  if (!Array.isArray(steps)) return "no steps bound";
  if (!lock.take(id)) return "already running";
  return null;
}

async function runLocked({ id, steps }, { signal, write, runAction, actionFor, ctx }) {
  const action = actionFor(id);
  write({ type: "action", id, status: "running" });
  const planned = { id, steps: async () => steps, preflight: action.preflight };
  const result = await runAction(planned, ctx, {
    signal,
    onLine: ({ line }) => write({ type: "action", id, line }),
    onStep: ({ label, critical }) => write({ type: "action", id, step: label, critical }),
  });
  write({
    type: "action",
    id,
    status: result.ok ? "ok" : "failed",
    ...(result.ok ? {} : { error: result.error }),
  });
  return result;
}
