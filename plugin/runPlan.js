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
 *   {type: "action", id, line}                         output
 *   {type: "action", id, status: "ok"|"failed", error?}
 *
 * The I/O is injected, so this is testable without deleting or running
 * anything.
 *
 * @param {Array<{kind: "path", path: string}|{kind: "action", id: string}>} items
 * @param {{permanent: boolean, signal?: AbortSignal, write: (note: object) => void,
 *          zapPaths: Function, runAction: Function,
 *          actionFor: (id: string) => object|null, ctx: object}} deps
 * @returns {Promise<{deleted: string[], failed: object[],
 *                    actions: Array<{id: string, ok: boolean, error?: string}>}>}
 */
export async function runPlan(items, deps) {
  const paths = items.filter((i) => i.kind === "path").map((i) => i.path);
  const ids = items.filter((i) => i.kind === "action").map((i) => i.id);

  const results = paths.length > 0 ? await deletePaths(paths, deps) : [];
  const actions = [];
  for (const id of ids) actions.push(await runOne(id, deps));

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

async function runOne(id, { signal, write, runAction, actionFor, ctx }) {
  const action = actionFor(id);
  if (!action) {
    const result = { id, ok: false, error: "unknown action" };
    write({ type: "action", id, status: "failed", error: result.error });
    return result;
  }

  write({ type: "action", id, status: "running" });
  const result = await runAction(action, ctx, {
    signal,
    onLine: ({ line }) => write({ type: "action", id, line }),
  });
  write({
    type: "action",
    id,
    status: result.ok ? "ok" : "failed",
    ...(result.ok ? {} : { error: result.error }),
  });
  return result;
}
