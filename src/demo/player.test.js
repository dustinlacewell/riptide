/**
 * Tests for the demo's timeline player.
 *
 *   node --test src/demo/player.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { instantSleep, play, realSleep } from "./player.js";

const script = {
  steps: [
    { dt: 10, note: "a" },
    { dt: 0, note: "b" },
    { dt: 5 },
    { dt: 20, note: "c" },
  ],
  done: "finished",
};

test("emits notes in order and resolves with the done value", async () => {
  const seen = [];
  const done = await play(script, (n) => seen.push(n), { sleep: instantSleep });
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.equal(done, "finished");
});

test("waits each step's dt through the injected sleep", async () => {
  const waits = [];
  await play(script, () => {}, { sleep: async (ms) => void waits.push(ms) });
  assert.deepEqual(waits, [10, 5, 20], "a zero dt does not sleep");
});

test("reads a done function after the last step", async () => {
  const seen = [];
  const done = await play(
    { steps: [{ dt: 1, note: 1 }], done: () => `after ${seen.length}` },
    (n) => seen.push(n),
    { sleep: instantSleep },
  );
  assert.equal(done, "after 1");
});

test("an abort mid-run rejects with an AbortError and emits nothing more", async () => {
  const controller = new AbortController();
  const seen = [];
  const run = play(
    script,
    (n) => {
      seen.push(n);
      if (n === "b") controller.abort();
    },
    { sleep: instantSleep, signal: controller.signal },
  );
  await assert.rejects(run, (err) => err.name === "AbortError" && err instanceof DOMException);
  assert.deepEqual(seen, ["a", "b"]);
});

test("an abort during a real sleep cuts the wait short", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const run = play({ steps: [{ dt: 5000, note: "late" }], done: 1 }, () => {}, {
    sleep: realSleep,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(run, { name: "AbortError" });
  assert.ok(Date.now() - started < 1000);
});

test("an already-aborted signal rejects before the first note", async () => {
  const seen = [];
  await assert.rejects(
    play(script, (n) => seen.push(n), { sleep: instantSleep, signal: AbortSignal.abort() }),
    { name: "AbortError" },
  );
  assert.deepEqual(seen, []);
});
