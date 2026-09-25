/**
 * The tally of a delete run, as data: the server's per-path results folded into what
 * has been freed, which rows are wiping out, and which failed.
 *
 * Pure. The server reports only a path and ok; the bytes come from what
 * the client already knows about each path, looked up through pathKey
 * because the server writes paths through path.resolve.
 *
 *   wiping  paths deleted but still on screen, mid-animation; the panel
 *           removes each row and then sends "removed"
 *   failed  pathKey -> error, for rows that stay with the reason inline
 */

import { bytesParts } from "./format.js";
import { pathKey } from "./pathKey.js";

/**
 * @param {{paths: string[], sizes: Map<string, string>, permanent: boolean,
 *          t: number, actions?: Array<{id: string, label: string}>}} opts
 *   sizes from sizesByPath; actions from the plan, in run order
 */
export function startRun({ paths, sizes, permanent, t, actions = [] }) {
  return {
    permanent,
    sizes,
    actions: actions.map(({ id, label }) => ({ id, label, status: "waiting", line: null, error: null })),
    total: paths.length,
    done: 0,
    deleted: 0,
    freed: "0",
    wiping: new Set(),
    failed: new Map(),
    startedAt: t,
    receipt: null,
  };
}

/** Index a scan's rows by pathKey for startRun. */
export function sizesByPath(items) {
  return new Map(items.map((item) => [pathKey(item.path), item.bytes]));
}

/**
 * One progress note: {path, ok, error?, done, total}.
 */
export function applyDeleteNote(run, note) {
  const key = pathKey(note.path);
  const base = { ...run, done: note.done ?? run.done + 1, total: note.total ?? run.total };

  if (!note.ok) {
    return { ...base, failed: new Map(run.failed).set(key, note.error ?? "failed") };
  }
  const size = BigInt(run.sizes.get(key) ?? "0");
  return {
    ...base,
    deleted: run.deleted + 1,
    freed: (BigInt(run.freed) + size).toString(),
    wiping: new Set(run.wiping).add(key),
  };
}

/**
 * One action note: {id, status: "running"|"ok"|"failed", error?} or
 * {id, line}. The run keeps only each action's latest line.
 */
export function applyActionNote(run, note) {
  const actions = run.actions.map((a) => {
    if (a.id !== note.id) return a;
    if (typeof note.line === "string") return { ...a, line: note.line };
    return { ...a, status: note.status ?? a.status, error: note.error ?? null };
  });
  return { ...run, actions };
}

/** A wiped row has left the table. */
export function removedFromView(run, path) {
  const key = pathKey(path);
  if (!run.wiping.has(key)) return run;
  const wiping = new Set(run.wiping);
  wiping.delete(key);
  return { ...run, wiping };
}

/** The run ended. elapsedMs is the server's figure when it sent one. */
export function finishRun(run, { t, elapsedMs }) {
  return {
    ...run,
    receipt: {
      freed: run.freed,
      deleted: run.deleted,
      failed: run.failed.size,
      ms: elapsedMs ?? t - run.startedAt,
    },
  };
}

/** How a row should look while a run is on: gone, failed, or untouched. */
export function fateOf(run, path) {
  if (!run || (run.wiping.size === 0 && run.failed.size === 0)) return null;
  const key = pathKey(path);
  if (run.wiping.has(key)) return { gone: true };
  const error = run.failed.get(key);
  return error === undefined ? null : { error };
}

/**
 * The row class a fate adds: "row-out" while it wipes away, "failed" when
 * it stays behind.
 */
export function fateClass(fate) {
  if (fate?.gone) return "row-out";
  if (fate?.error !== undefined) return "failed";
  return "";
}

/** "freed 41.8 GB · 312 folders · 3.1 s" */
export function runReceiptLine({ freed, deleted, ms }, noun = ["folder", "folders"]) {
  const things = deleted === 1 ? noun[0] : noun[1];
  const { value, unit } = bytesParts(freed);
  return `freed ${value} ${unit} · ${deleted.toLocaleString()} ${things} · ${(ms / 1000).toFixed(1)} s`;
}
