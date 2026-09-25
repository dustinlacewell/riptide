/**
 * Scan telemetry as data: the server's progress notes folded into one
 * state the telemetry panel draws.
 *
 * Pure. Every action carries its own time `t` (ms), so the reducer never
 * reads a clock.
 *
 *   phase     idle | read | index | size | done
 *   strategy  mft | walk | null (not yet known)
 *   rate      records (or folders, on a walk) per second over the last
 *             second or so
 */

import { compactCount } from "./format.js";

const RATE_WINDOW_MS = 1000;

export const IDLE = Object.freeze({
  phase: "idle",
  strategy: null,
  reason: null,
  drive: null,
  driveIndex: 0,
  driveCount: 0,
  recordsDone: 0,
  recordsTotal: null,
  recordsRead: 0,
  rate: 0,
  samples: [],
  matches: null,
  sized: null,
  startedAt: null,
  finishedAt: null,
  receipt: null,
});

/**
 * @param {typeof IDLE} state
 * @param {{type: "start"|"note"|"finish"|"reset", t?: number,
 *          note?: object, stats?: object, elapsedMs?: number,
 *          strategy?: string}} action
 */
export function scanReducer(state, action) {
  switch (action.type) {
    case "start":
      return { ...IDLE, phase: "read", startedAt: action.t };
    case "note":
      return applyNote(state, action.note, action.t);
    case "finish":
      return finish(state, action);
    case "reset":
      return IDLE;
    default:
      return state;
  }
}

/**
 * How full the bar is, 0..1. Null while a walk reads folders: it has no
 * total to measure against.
 */
export function fractionOf(state) {
  if (state.phase === "done") return 1;
  if (state.sized) return state.sized.total ? state.sized.done / state.sized.total : 1;
  if (state.strategy === "walk") return null;
  if (state.phase === "index" || state.phase === "size") return 1;
  return state.recordsTotal ? state.recordsDone / state.recordsTotal : 0;
}

/** The step names for a strategy, and which one is current. */
export function stepsOf(state) {
  if (state.strategy === "walk") {
    return { steps: ["walk", "size"], current: state.phase === "size" ? 1 : 0 };
  }
  const steps = ["read", "index", "size"];
  return { steps, current: steps.indexOf(state.phase) };
}

/** "4.87M records · 26.1 s · MFT" */
export function receiptLine({ records, ms, strategy }) {
  const walk = strategy === "walk";
  const unit = walk ? "folders" : "records";
  return `${compactCount(records)} ${unit} · ${(ms / 1000).toFixed(1)} s · ${walk ? "walk" : "MFT"}`;
}

/** What to tell the user when the scan fell back to a walk. */
export function walkHint(reason) {
  if (!reason || /EPERM|EACCES/.test(reason)) return "Run as administrator for the fast path.";
  return reason;
}

// ---------------------------------------------------------------------------

const STAGES = {
  "reading-mft": (s, n) => ({ ...freshDrive(s, n), strategy: "mft", phase: "read" }),
  boot: (s) => ({ ...s, strategy: "mft", phase: "read" }),
  "mft-header": (s, n) => ({ ...s, recordsTotal: n.recordsTotal }),
  "mft-stream": (s, n, t) =>
    withRecords(
      { ...s, recordsTotal: n.recordsTotal ?? s.recordsTotal, matches: n.matches ?? s.matches },
      n.recordsDone,
      t,
    ),
  "mft-done": (s, n, t) => ({
    ...withRecords(s, n.recordsDone, t),
    recordsRead: s.recordsRead + n.recordsDone,
  }),
  index: (s) => ({ ...s, phase: "index" }),
  size: (s) => ({ ...s, phase: "size" }),
  "mft-unavailable": (s, n) => ({
    ...restartCount(s),
    strategy: "walk",
    phase: "read",
    reason: n.reason ?? null,
  }),
  walk: (s, n, t) =>
    withRecords({ ...s, strategy: "walk", phase: "read", matches: n.matches ?? s.matches }, n.dirs, t),
  sizing: (s, n) => ({ ...s, phase: "size", sized: { done: n.done, total: n.total } }),
};

function applyNote(state, note, t) {
  const step = STAGES[note?.stage];
  if (!step) return state;
  const next = step(state, note, t);
  return note.drive ? { ...next, drive: note.drive } : next;
}

/** A new drive in a multi-drive run starts its own count. */
function freshDrive(state, note) {
  return {
    ...restartCount(state),
    drive: note.drive ?? state.drive,
    driveIndex: note.driveIndex ?? 0,
    driveCount: note.driveCount ?? 0,
  };
}

function restartCount(state) {
  return {
    ...state,
    recordsDone: 0,
    recordsTotal: null,
    rate: 0,
    samples: [],
    matches: null,
    sized: null,
  };
}

/**
 * Record a new count and update the rate. The oldest sample kept is the
 * newest one at least a window old, so the rate spans about a second.
 */
function withRecords(state, count, t) {
  if (!Number.isFinite(count)) return state;
  const samples = [...state.samples, { t, n: count }];
  while (samples.length > 2 && t - samples[1].t >= RATE_WINDOW_MS) samples.shift();

  const first = samples[0];
  const span = t - first.t;
  const rate = span > 0 ? ((count - first.n) / span) * 1000 : state.rate;
  return { ...state, recordsDone: count, samples, rate };
}

function finish(state, { t, stats, elapsedMs, strategy }) {
  const how = strategy ?? state.strategy ?? "mft";
  const records = stats?.records ?? (state.recordsRead || state.recordsDone);
  const ms = elapsedMs ?? t - (state.startedAt ?? t);
  return {
    ...state,
    phase: "done",
    strategy: how,
    finishedAt: t,
    receipt: { records, ms, strategy: how },
  };
}
