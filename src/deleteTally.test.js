/**
 * Tests for delete-run accounting.
 *
 *   node --test src/deleteTally.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyActionNote,
  applyDeleteNote,
  criticalStep,
  fateClass,
  fateOf,
  finishRun,
  removedFromView,
  runReceiptLine,
  sizesByPath,
  startRun,
} from "./deleteTally.js";

const GB = 1024 ** 3;
const B18 = Math.round(1.8 * GB);
const ROWS = [
  { path: "D:\\code\\a\\node_modules", bytes: String(40 * GB) },
  { path: "D:\\code\\b\\node_modules", bytes: String(B18) },
  { path: "D:\\code\\c\\node_modules", bytes: "100" },
];

function begin() {
  return startRun({
    paths: ROWS.map((r) => r.path),
    sizes: sizesByPath(ROWS),
    permanent: false,
    t: 1000,
  });
}

test("a deleted path adds the client's bytes for it to freed", () => {
  const run = applyDeleteNote(begin(), { path: ROWS[0].path, ok: true, done: 1, total: 3 });
  assert.equal(run.freed, String(40 * GB));
  assert.equal(run.deleted, 1);
  assert.equal(run.done, 1);
});

test("bytes are found whatever way the server wrote the path", () => {
  const run = applyDeleteNote(begin(), { path: "d:/code/b/node_modules/", ok: true, done: 1, total: 3 });
  assert.equal(run.freed, String(B18));
});

test("a failed path frees nothing and keeps its error", () => {
  const run = applyDeleteNote(begin(), { path: ROWS[2].path, ok: false, error: "in use", done: 1, total: 3 });
  assert.equal(run.freed, "0");
  assert.equal(run.deleted, 0);
  assert.deepEqual(fateOf(run, ROWS[2].path), { error: "in use" });
});

test("a path unknown to the client counts as deleted but frees no bytes", () => {
  const run = applyDeleteNote(begin(), { path: "D:\\elsewhere", ok: true, done: 1, total: 3 });
  assert.equal(run.deleted, 1);
  assert.equal(run.freed, "0");
});

test("a deleted row wipes, then leaves the view", () => {
  let run = applyDeleteNote(begin(), { path: ROWS[0].path, ok: true, done: 1, total: 3 });
  assert.deepEqual(fateOf(run, ROWS[0].path), { gone: true });
  run = removedFromView(run, ROWS[0].path);
  assert.equal(fateOf(run, ROWS[0].path), null);
  assert.equal(run.freed, String(40 * GB), "leaving the view does not undo the count");
});

test("a fate names its row class", () => {
  assert.equal(fateClass({ gone: true }), "row-out");
  assert.equal(fateClass({ error: "in use" }), "failed");
  assert.equal(fateClass(null), "");
});

test("an untouched row has no fate, and neither does any row without a run", () => {
  assert.equal(fateOf(begin(), ROWS[1].path), null);
  assert.equal(fateOf(null, ROWS[1].path), null);
});

test("the receipt reads freed, count and time", () => {
  let run = begin();
  run = applyDeleteNote(run, { path: ROWS[0].path, ok: true, done: 1, total: 3 });
  run = applyDeleteNote(run, { path: ROWS[1].path, ok: true, done: 2, total: 3 });
  run = applyDeleteNote(run, { path: ROWS[2].path, ok: false, error: "x", done: 3, total: 3 });
  run = finishRun(run, { t: 9000, elapsedMs: 3100 });
  assert.deepEqual(run.receipt, { freed: String(40 * GB + B18), deleted: 2, failed: 1, ms: 3100 });
  assert.equal(runReceiptLine(run.receipt), "freed 41.8 GB · 2 folders · 3.1 s");
});

test("the receipt times from the start when the server sent no time", () => {
  const run = finishRun(begin(), { t: 4100 });
  assert.equal(run.receipt.ms, 3100);
});

test("the receipt names what was deleted", () => {
  const line = runReceiptLine({ freed: "0", deleted: 1, ms: 0 }, ["location", "locations"]);
  assert.equal(line, "freed 0 B · 1 location · 0.0 s");
});

test("actions: each keeps its status and only its latest line", () => {
  let run = startRun({
    paths: [],
    sizes: new Map(),
    permanent: false,
    t: 0,
    actions: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  });
  assert.deepEqual(run.actions.map((a) => a.status), ["waiting", "waiting"]);

  run = applyActionNote(run, { id: "a", status: "running" });
  run = applyActionNote(run, { id: "a", line: "one" });
  run = applyActionNote(run, { id: "a", line: "two" });
  run = applyActionNote(run, { id: "a", status: "failed", error: "exit code 1" });
  run = applyActionNote(run, { id: "b", status: "ok" });

  assert.deepEqual(run.actions, [
    { id: "a", label: "A", status: "failed", line: "two", error: "exit code 1", step: null, critical: false },
    { id: "b", label: "B", status: "ok", line: null, error: null, step: null, critical: false },
  ]);
  assert.equal(run.freed, "0", "an action adds nothing to freed");
});

test("actions: a critical step is reported while it runs, and not after", () => {
  let run = startRun({ paths: [], sizes: new Map(), permanent: false, t: 0, actions: [{ id: "w", label: "W" }] });
  run = applyActionNote(run, { id: "w", status: "running" });
  run = applyActionNote(run, { id: "w", step: "wsl --shutdown", critical: false });
  assert.equal(criticalStep(run), null);
  run = applyActionNote(run, { id: "w", step: "diskpart: compact C:\\x.vhdx", critical: true });
  assert.equal(criticalStep(run), "diskpart: compact C:\\x.vhdx");
  run = applyActionNote(run, { id: "w", line: "100 percent completed" });
  assert.equal(criticalStep(run), "diskpart: compact C:\\x.vhdx");
  run = applyActionNote(run, { id: "w", status: "ok" });
  assert.equal(criticalStep(run), null);
  assert.equal(criticalStep(null), null);
});
