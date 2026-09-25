/**
 * Tests for running actions. Every process here is a fake.
 *
 *   node --test plugin/actions/run.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { capture, commandText, createLineSplitter, runAction, runStep } from "./run.js";
import { createSpawner, findExe, onPath } from "./spawn.js";
import { createFakeSpawn } from "./fakeSpawn.js";
import { ACTIONS, actionFor } from "./index.js";

const action = (steps) => ({ id: "demo", steps: async () => steps });

test("run: spawns each step with its exact argv, in order", async () => {
  const fake = createFakeSpawn();
  const result = await runAction(
    action([
      { exe: "C:\\bin\\a.exe", args: ["one", "two words"], timeoutMs: 1000 },
      { exe: "C:\\bin\\b.exe", args: [], timeoutMs: 1000 },
    ]),
    { spawn: fake.spawn },
  );
  assert.deepEqual(result, { id: "demo", ok: true });
  assert.deepEqual(
    fake.calls.map(({ exe, args }) => ({ exe, args })),
    [
      { exe: "C:\\bin\\a.exe", args: ["one", "two words"] },
      { exe: "C:\\bin\\b.exe", args: [] },
    ],
  );
});

test("run: a non-zero exit fails the action and skips later steps", async () => {
  const fake = createFakeSpawn((exe) => ({ code: exe.endsWith("a.exe") ? 3 : 0 }));
  const result = await runAction(
    action([
      { exe: "C:\\bin\\a.exe", args: [], timeoutMs: 1000 },
      { exe: "C:\\bin\\b.exe", args: [], timeoutMs: 1000 },
    ]),
    { spawn: fake.spawn },
  );
  assert.deepEqual(result, { id: "demo", ok: false, error: "exit code 3" });
  assert.equal(fake.calls.length, 1);
});

test("run: a program that fails to start fails the action", async () => {
  const fake = createFakeSpawn(() => ({ error: new Error("spawn ENOENT") }));
  const result = await runAction(
    action([{ exe: "C:\\nope.exe", args: [], timeoutMs: 1000 }]),
    { spawn: fake.spawn },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "spawn ENOENT");
});

test("run: steps() throwing fails the action without spawning", async () => {
  const fake = createFakeSpawn();
  const result = await runAction(
    { id: "demo", steps: async () => { throw new Error("no disks"); } },
    { spawn: fake.spawn },
  );
  assert.deepEqual(result, { id: "demo", ok: false, error: "no disks" });
  assert.equal(fake.calls.length, 0);
});

test("run: output lines stream as {id, line}, from both streams", async () => {
  const fake = createFakeSpawn(() => ({
    stdout: ["first\r\nsec", "ond\n\n", "progress 10%\rprogress 20%"],
    stderr: ["warn\n"],
  }));
  const lines = [];
  await runAction(action([{ exe: "C:\\a.exe", args: [], timeoutMs: 1000 }]), { spawn: fake.spawn }, {
    onLine: (note) => lines.push(note),
  });
  assert.deepEqual(
    lines.map((n) => n.line),
    // The unterminated last stdout line arrives when the process closes.
    ["first", "second", "progress 10%", "warn", "progress 20%"],
  );
  assert.ok(lines.every((n) => n.id === "demo"));
});

test("run: a timeout kills the child and fails", async () => {
  const fake = createFakeSpawn(() => ({ hang: true }));
  const result = await runStep(
    { exe: "C:\\a.exe", args: [], timeoutMs: 20 },
    { spawn: fake.spawn },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
  assert.equal(fake.calls[0].killed, true);
});

test("run: an abort kills the running child and skips later steps", async () => {
  const fake = createFakeSpawn(() => ({ hang: true }));
  const controller = new AbortController();
  const pending = runAction(
    action([
      { exe: "C:\\a.exe", args: [], timeoutMs: 60_000 },
      { exe: "C:\\b.exe", args: [], timeoutMs: 60_000 },
    ]),
    { spawn: fake.spawn },
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.deepEqual(result, { id: "demo", ok: false, error: "stopped" });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].killed, true);
});

test("run: an already-aborted signal spawns nothing", async () => {
  const fake = createFakeSpawn();
  const controller = new AbortController();
  controller.abort();
  const result = await runStep(
    { exe: "C:\\a.exe", args: [], timeoutMs: 1000 },
    { spawn: fake.spawn, signal: controller.signal },
  );
  assert.deepEqual(result, { ok: false, error: "stopped" });
  assert.equal(fake.calls.length, 0);
});

test("run: a step's script file exists during the spawn and is gone after", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "riptide-run-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const script = path.join(dir, "s.txt");

  let seen = null;
  const fake = createFakeSpawn(() => ({ code: 0 }));
  const spawn = (exe, args) => {
    seen = fsp.readFile(script, "utf8");
    return fake.spawn(exe, args);
  };
  const result = await runStep(
    { exe: "C:\\a.exe", args: ["/s", script], timeoutMs: 1000, writes: { path: script, text: "hello" } },
    { spawn },
  );
  assert.equal(result.ok, true);
  assert.equal(await seen, "hello");
  await assert.rejects(fsp.stat(script));
});

test("run: a script file that already exists is not overwritten", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "riptide-run-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const script = path.join(dir, "s.txt");
  await fsp.writeFile(script, "theirs");

  const fake = createFakeSpawn();
  const result = await runStep(
    { exe: "C:\\a.exe", args: [], timeoutMs: 1000, writes: { path: script, text: "ours" } },
    { spawn: fake.spawn },
  );
  assert.equal(result.ok, false);
  assert.equal(fake.calls.length, 0);
});

test("capture: keeps stdout lines only", async () => {
  const fake = createFakeSpawn(() => ({ stdout: ["a\nb\n"], stderr: ["noise\n"] }));
  const result = await capture(fake.spawn, { exe: "C:\\a.exe", args: [], timeoutMs: 1000 });
  assert.deepEqual(result.stdout, ["a", "b"]);
  assert.equal(result.ok, true);
});

test("spawner: no shell, argv passed as given, batch files refused", () => {
  const seen = [];
  const spawner = createSpawner((exe, args, opts) => {
    seen.push({ exe, args, opts });
    return {};
  }, { PATH: "C:\\x" });

  spawner("C:\\bin\\tool.exe", ["a;b", "&& c", "\"d\""]);
  assert.equal(seen[0].opts.shell, false);
  assert.deepEqual(seen[0].args, ["a;b", "&& c", "\"d\""]);
  assert.equal(seen[0].opts.env.WSL_UTF8, "1");

  assert.throws(() => spawner("C:\\bin\\pnpm.cmd", []));
  assert.throws(() => spawner("C:\\bin\\x.BAT", []));
  assert.throws(() => spawner("C:\\bin\\tool.exe", "a b"));
  assert.throws(() => spawner("C:\\bin\\tool.exe", [1]));
});

test("findExe: PATH first, then known paths; relative PATH entries skipped", async () => {
  const env = { PATH: "relative\\bin;C:\\one;\"C:\\two\"" };
  assert.deepEqual(onPath("x.exe", env), ["C:\\one\\x.exe", "C:\\two\\x.exe"]);

  const present = new Set(["C:\\two\\x.exe", "C:\\known\\x.exe"]);
  const isFile = async (p) => present.has(p);
  assert.equal(await findExe("x", { env, known: ["C:\\known\\x.exe"], isFile }), "C:\\two\\x.exe");
  assert.equal(
    await findExe("x", { env: { PATH: "" }, known: ["C:\\known\\x.exe"], isFile }),
    "C:\\known\\x.exe",
  );
  assert.equal(await findExe("x", { env: {}, isFile }), null);
});

test("commandText: label wins, else program name and args", () => {
  assert.equal(
    commandText({ exe: "C:\\Program Files\\Docker\\docker.exe", args: ["image", "prune", "-f"] }),
    "docker image prune -f",
  );
  assert.equal(commandText({ exe: "node.exe", args: ["x.cjs"], label: "pnpm store prune" }), "pnpm store prune");
});

test("lines: a multi-byte character split across chunks survives", () => {
  const lines = [];
  const split = createLineSplitter((l) => lines.push(l));
  const bytes = Buffer.from("héllo\n");
  split.push(bytes.subarray(0, 2));
  split.push(bytes.subarray(2));
  split.flush();
  assert.deepEqual(lines, ["héllo"]);
});

test("registry: ids are unique and every action has the full shape", () => {
  const ids = ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of ACTIONS) {
    assert.equal(actionFor(a.id), a);
    for (const key of ["id", "label", "tool", "cost"]) assert.equal(typeof a[key], "string", `${a.id}.${key}`);
    assert.ok(a.risk === "safe" || a.risk === "caution", a.id);
    if (a.risk === "caution") assert.equal(typeof a.riskNote, "string", a.id);
    assert.equal(typeof a.detect, "function");
    assert.equal(typeof a.steps, "function");
  }
  assert.equal(actionFor("nope"), null);
});
