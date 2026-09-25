/**
 * Tests for the scan telemetry reducer.
 *
 *   node --test src/scanStream.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  IDLE,
  fractionOf,
  receiptLine,
  scanReducer,
  stepsOf,
  walkHint,
} from "./scanStream.js";

/** Run actions through the reducer from a fresh start at t = 0. */
function run(...notes) {
  let state = scanReducer(IDLE, { type: "start", t: 0 });
  for (const [t, note] of notes) state = scanReducer(state, { type: "note", t, note });
  return state;
}

test("start clears a previous run and enters read", () => {
  const state = run();
  assert.equal(state.phase, "read");
  assert.equal(state.startedAt, 0);
  assert.equal(state.recordsDone, 0);
});

test("the MFT header sets the total and the stream moves the count", () => {
  const state = run(
    [10, { stage: "boot" }],
    [20, { stage: "mft-header", recordsTotal: 1000, mftBytes: 1024000 }],
    [120, { stage: "mft-stream", recordsDone: 250, recordsTotal: 1000, bytesRead: 1, dirs: 3 }],
  );
  assert.equal(state.strategy, "mft");
  assert.equal(state.recordsTotal, 1000);
  assert.equal(state.recordsDone, 250);
  assert.equal(fractionOf(state), 0.25);
});

test("rate is records per second over about a second", () => {
  const state = run(
    [0, { stage: "mft-stream", recordsDone: 0, recordsTotal: 10_000 }],
    [500, { stage: "mft-stream", recordsDone: 500, recordsTotal: 10_000 }],
    [1000, { stage: "mft-stream", recordsDone: 1000, recordsTotal: 10_000 }],
    [1500, { stage: "mft-stream", recordsDone: 3000, recordsTotal: 10_000 }],
  );
  // Window runs from t=500 (the newest sample at least 1 s old): 2500 in 1 s.
  assert.equal(state.rate, 2500);
});

test("matches come from the stream only when it sends them", () => {
  const without = run([100, { stage: "mft-stream", recordsDone: 1, recordsTotal: 2 }]);
  assert.equal(without.matches, null);
  const withMatches = run([100, { stage: "mft-stream", recordsDone: 1, recordsTotal: 2, matches: 7 }]);
  assert.equal(withMatches.matches, 7);
});

test("index and size advance the phase dots", () => {
  const state = run([10, { stage: "boot" }], [20, { stage: "index" }]);
  assert.deepEqual(stepsOf(state), { steps: ["read", "index", "size"], current: 1 });
  assert.equal(fractionOf(state), 1);
  assert.equal(stepsOf(run([20, { stage: "size" }])).current, 2);
});

test("a fallback to the walk switches strategy and restarts the count", () => {
  const state = run(
    [10, { stage: "mft-header", recordsTotal: 1000 }],
    [20, { stage: "mft-unavailable", reason: "EPERM: operation not permitted" }],
    [30, { stage: "walk", dirs: 12, matches: 2 }],
  );
  assert.equal(state.strategy, "walk");
  assert.equal(state.recordsTotal, null);
  assert.equal(state.recordsDone, 12);
  assert.equal(state.matches, 2);
  assert.equal(fractionOf(state), null, "a walk has no total to fill against");
  assert.deepEqual(stepsOf(state), { steps: ["walk", "size"], current: 0 });
});

test("walk sizing fills the bar by done of total", () => {
  const state = run(
    [20, { stage: "mft-unavailable", reason: "x" }],
    [40, { stage: "sizing", done: 3, total: 12 }],
  );
  assert.equal(state.phase, "size");
  assert.equal(fractionOf(state), 0.25);
  assert.equal(stepsOf(state).current, 1);
});

test("each drive of a cache run starts its own count and keeps its place", () => {
  const state = run(
    [0, { stage: "reading-mft", drive: "C:", driveIndex: 1, driveCount: 2 }],
    [10, { stage: "mft-stream", recordsDone: 900, recordsTotal: 900, drive: "C:" }],
    [20, { stage: "mft-done", recordsDone: 900, recordsTotal: 900, drive: "C:" }],
    [30, { stage: "reading-mft", drive: "D:", driveIndex: 2, driveCount: 2 }],
  );
  assert.equal(state.drive, "D:");
  assert.equal(state.driveIndex, 2);
  assert.equal(state.recordsDone, 0);
  assert.equal(state.recordsRead, 900, "the finished drive still counts toward the receipt");
});

test("finish writes the receipt from server stats when given", () => {
  const state = scanReducer(run([10, { stage: "boot" }]), {
    type: "finish",
    t: 30_000,
    strategy: "mft",
    stats: { records: 4_870_112 },
    elapsedMs: 26_100,
  });
  assert.equal(state.phase, "done");
  assert.deepEqual(state.receipt, { records: 4_870_112, ms: 26_100, strategy: "mft", how: "full", changes: 0 });
  assert.equal(receiptLine(state.receipt), "full read 4.87M records · 26.1 s");
});

test("a run of journal updates gets an update receipt", () => {
  const state = scanReducer(
    run(
      [0, { stage: "reading-mft", drive: "C:", driveIndex: 1, driveCount: 2 }],
      [5, { stage: "journal", drive: "C:" }],
      [10, { stage: "mft-delta", drive: "C:", changes: 3_000, ms: 300 }],
      [20, { stage: "reading-mft", drive: "D:", driveIndex: 2, driveCount: 2 }],
      [30, { stage: "mft-delta", drive: "D:", changes: 120, ms: 100 }],
    ),
    { type: "finish", t: 400 },
  );
  assert.equal(state.receipt.how, "delta");
  assert.equal(receiptLine(state.receipt), "updated 3,120 changes · 0.4 s");
});

test("one full read among updates makes the receipt a full read", () => {
  const state = scanReducer(
    run(
      [10, { stage: "mft-delta", changes: 5 }],
      [20, { stage: "mft-done", recordsDone: 900, recordsTotal: 900 }],
    ),
    { type: "finish", t: 400 },
  );
  assert.equal(state.receipt.how, "full");
});

test("server stats say how the Zap scan read", () => {
  const state = scanReducer(run(), {
    type: "finish",
    t: 500,
    strategy: "mft",
    stats: { records: 10, how: "delta", changes: 42 },
    elapsedMs: 500,
  });
  assert.equal(receiptLine(state.receipt), "updated 42 changes · 0.5 s");
});

test("finish without stats sums the drives read and times from start", () => {
  const state = scanReducer(
    run(
      [0, { stage: "reading-mft", drive: "C:", driveIndex: 1, driveCount: 2 }],
      [10, { stage: "mft-done", recordsDone: 1500, recordsTotal: 1500 }],
      [20, { stage: "reading-mft", drive: "D:", driveIndex: 2, driveCount: 2 }],
      [30, { stage: "mft-done", recordsDone: 500, recordsTotal: 500 }],
    ),
    { type: "finish", t: 4000 },
  );
  assert.deepEqual(state.receipt, { records: 2000, ms: 4000, strategy: "mft", how: "full", changes: 0 });
});

test("a walk receipt counts folders", () => {
  assert.equal(receiptLine({ records: 812, ms: 42_000, strategy: "walk" }), "812 folders · 42.0 s · walk");
});

test("unknown notes change nothing", () => {
  const state = run();
  assert.equal(scanReducer(state, { type: "note", t: 5, note: { stage: "mystery" } }), state);
});

test("reset returns to idle", () => {
  assert.equal(scanReducer(run(), { type: "reset" }), IDLE);
});

test("walkHint points at elevation for a permission failure only", () => {
  assert.equal(walkHint("EPERM: operation not permitted"), "Run as administrator for the fast path.");
  assert.equal(walkHint("root is not a drive path"), "root is not a drive path");
});
