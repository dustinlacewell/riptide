/**
 * Tests for carrying out a plan and for listing actions, with every
 * delete and every process stubbed.
 *
 *   node --test plugin/runPlan.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runPlan } from "./runPlan.js";
import { listActions } from "./actions/list.js";
import { runAction } from "./actions/run.js";
import { createFakeSpawn } from "./actions/fakeSpawn.js";

function fakeAction(id, steps, detect = async () => ({ available: true, bytes: null })) {
  return { id, label: id, tool: "t", risk: "safe", cost: "", detect, steps: async () => steps };
}

function stubZap(calls) {
  return async (paths, { permanent, onProgress }) => {
    calls.push({ paths, permanent });
    return paths.map((p, i) => {
      const result = p.endsWith("bad") ? { path: p, ok: false, error: "denied" } : { path: p, ok: true };
      onProgress({ ...result, done: i + 1, total: paths.length });
      return result;
    });
  };
}

test("runPlan: paths first, then actions in order, with their output", async () => {
  const zapCalls = [];
  const fake = createFakeSpawn((exe) => (exe === "C:\\b.exe" ? { stdout: ["pruned 3\n"], code: 0 } : { code: 0 }));
  const registry = {
    a: fakeAction("a", [{ exe: "C:\\a.exe", args: ["x"], timeoutMs: 1000 }]),
    b: fakeAction("b", [{ exe: "C:\\b.exe", args: [], timeoutMs: 1000 }]),
  };
  const notes = [];

  const result = await runPlan(
    [
      { kind: "action", id: "b" },
      { kind: "path", path: "C:\\x\\good" },
      { kind: "action", id: "a" },
      { kind: "path", path: "C:\\x\\bad" },
    ],
    {
      permanent: true,
      write: (n) => notes.push(n),
      zapPaths: stubZap(zapCalls),
      runAction,
      actionFor: (id) => registry[id] ?? null,
      ctx: { spawn: fake.spawn },
    },
  );

  assert.deepEqual(zapCalls, [{ paths: ["C:\\x\\good", "C:\\x\\bad"], permanent: true }]);
  assert.deepEqual(fake.calls.map((c) => c.exe), ["C:\\b.exe", "C:\\a.exe"]);
  assert.deepEqual(result.deleted, ["C:\\x\\good"]);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(result.actions, [
    { id: "b", ok: true },
    { id: "a", ok: true },
  ]);
  assert.deepEqual(
    notes.filter((n) => n.type === "action"),
    [
      { type: "action", id: "b", status: "running" },
      { type: "action", id: "b", line: "pruned 3" },
      { type: "action", id: "b", status: "ok" },
      { type: "action", id: "a", status: "running" },
      { type: "action", id: "a", status: "ok" },
    ],
  );
  // Path notes keep their old shape.
  assert.deepEqual(notes[0], { type: "progress", path: "C:\\x\\good", ok: true, done: 1, total: 2 });
});

test("runPlan: a failed action does not stop the next; an unknown id fails", async () => {
  const fake = createFakeSpawn((exe) => ({ code: exe === "C:\\a.exe" ? 5 : 0 }));
  const registry = {
    a: fakeAction("a", [{ exe: "C:\\a.exe", args: [], timeoutMs: 1000 }]),
    b: fakeAction("b", [{ exe: "C:\\b.exe", args: [], timeoutMs: 1000 }]),
  };
  const zapCalls = [];
  const result = await runPlan(
    [{ kind: "action", id: "a" }, { kind: "action", id: "gone" }, { kind: "action", id: "b" }],
    {
      permanent: false,
      write: () => {},
      zapPaths: stubZap(zapCalls),
      runAction,
      actionFor: (id) => registry[id] ?? null,
      ctx: { spawn: fake.spawn },
    },
  );
  assert.deepEqual(zapCalls, [], "no paths, no delete call");
  assert.deepEqual(result.actions, [
    { id: "a", ok: false, error: "exit code 5" },
    { id: "gone", ok: false, error: "unknown action" },
    { id: "b", ok: true },
  ]);
});

test("runPlan: a disconnect kills the running action and starts no more", async () => {
  const fake = createFakeSpawn(() => ({ hang: true }));
  const registry = {
    a: fakeAction("a", [{ exe: "C:\\a.exe", args: [], timeoutMs: 60_000 }]),
    b: fakeAction("b", [{ exe: "C:\\b.exe", args: [], timeoutMs: 60_000 }]),
  };
  const controller = new AbortController();
  const pending = runPlan(
    [{ kind: "action", id: "a" }, { kind: "action", id: "b" }],
    {
      permanent: false,
      signal: controller.signal,
      write: () => {},
      zapPaths: stubZap([]),
      runAction,
      actionFor: (id) => registry[id],
      ctx: { spawn: fake.spawn },
    },
  );
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.deepEqual(fake.calls.map((c) => [c.exe, c.killed]), [["C:\\a.exe", true]]);
  assert.deepEqual(result.actions.map((a) => a.error), ["stopped", "stopped"]);
});

// --- listing ---------------------------------------------------------------

test("listActions: one row per action with availability, bytes and command text", async () => {
  const registry = {
    up: fakeAction("up", [{ exe: "C:\\bin\\tool.exe", args: ["clean", "-f"], timeoutMs: 1 }], async () => ({
      available: true,
      bytes: "1000",
    })),
    down: fakeAction("down", [], async () => ({ available: false, reason: "not running" })),
    boom: fakeAction("boom", [], async () => {
      throw new Error("probe crashed");
    }),
  };
  const entry = (id, action) => ({ id, action, label: id, tool: "t", pack: "p", cost: "c", risk: "safe", riskNote: null });

  const rows = await listActions(
    [entry("e1", "up"), entry("e2", "up"), entry("e3", "down"), entry("e4", "boom"), entry("e5", "missing")],
    {},
    { actionFor: (id) => registry[id] ?? null },
  );

  assert.deepEqual(
    rows.map(({ id, action, available, reason, bytes, commands }) => ({ id, action, available, reason, bytes, commands })),
    [
      { id: "e1", action: "up", available: true, reason: null, bytes: "1000", commands: ["tool clean -f"] },
      { id: "e3", action: "down", available: false, reason: "not running", bytes: null, commands: [] },
      { id: "e4", action: "boom", available: false, reason: "probe crashed", bytes: null, commands: [] },
    ],
  );
});
