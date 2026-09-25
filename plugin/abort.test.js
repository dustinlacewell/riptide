/**
 * Tests for stopping long runs: the scan loops, the MFT read, cache
 * resolution and ripgrep all give up once their AbortSignal fires.
 *
 *   node --test plugin/abort.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readVolumeTree, scanViaWalk } from "./mft/scan.js";
import { resolveEntries } from "./caches/resolve.js";
import { runRipgrep } from "./grep/run.js";

const isAbort = (err) => err?.name === "AbortError";

function aborted() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

/** root/a/b/c/d — four levels, so a walk takes four rounds. */
async function deepTree() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riptide-abort-"));
  await fsp.mkdir(path.join(root, "a", "b", "c", "d"), { recursive: true });
  return root;
}

test("the walk stops at the next level once the signal fires", async (t) => {
  const root = await deepTree();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const controller = new AbortController();
  const levels = [];

  await assert.rejects(
    scanViaWalk({
      root,
      matches: () => false,
      signal: controller.signal,
      onProgress: (note) => {
        if (note.stage !== "walk") return;
        levels.push(note.count);
        controller.abort();
      },
    }),
    isAbort,
  );

  assert.equal(levels.length, 1, "no level is read after the abort");
});

test("the walk runs to the end without a signal", async (t) => {
  const root = await deepTree();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const hits = await scanViaWalk({ root, matches: (n) => n === "c" });
  assert.equal(hits.length, 1);
  assert.equal(path.basename(hits[0].path), "c");
});

test("the walk does not start when the signal already fired", async () => {
  let progress = 0;
  await assert.rejects(
    scanViaWalk({
      root: os.tmpdir(),
      matches: () => false,
      signal: aborted(),
      onProgress: () => (progress += 1),
    }),
    isAbort,
  );
  assert.equal(progress, 0);
});

test("the MFT read does not open the volume when the signal already fired", async () => {
  // A drive that cannot exist: were the volume opened first, this would be
  // an ENOENT, not an abort.
  await assert.rejects(readVolumeTree("?:", { signal: aborted() }), isAbort);
});

test("cache resolution reads no drive once the signal fired", async () => {
  const progress = [];
  await assert.rejects(
    resolveEntries([], {
      drives: ["C:\\"],
      root: "C:\\",
      signal: aborted(),
      onProgress: (n) => progress.push(n),
    }),
    isAbort,
  );
  assert.deepEqual(progress, []);
});

test("a drive read that fails as the stop lands reports the stop", async () => {
  const controller = new AbortController();
  const progress = [];

  await assert.rejects(
    resolveEntries([], {
      drives: ["C:\\"],
      root: "C:\\x",
      signal: controller.signal,
      onProgress: (n) => progress.push(n.stage),
      // No volume is opened: the stand-in stops the run, then fails the way
      // a lost handle would.
      readTree: async () => {
        controller.abort();
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      },
    }),
    isAbort,
  );
  assert.ok(!progress.includes("mft-failed"), "no drive error is reported");
});

/** A stand-in for a ripgrep child process that runs until killed. */
function stubChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit("close", null));
    return true;
  };
  return child;
}

const SEARCH = { pattern: "x", root: "C:\\" };

test("an abort mid-search kills ripgrep", async () => {
  const child = stubChild();
  const controller = new AbortController();

  const run = runRipgrep(SEARCH, {
    onGroup: () => {},
    signal: controller.signal,
    spawnChild: () => child,
  });

  assert.equal(child.killed, false);
  controller.abort();

  const result = await run;
  assert.equal(child.killed, true);
  assert.equal(result.files, 0);
});

test("a search started with a fired signal kills ripgrep at once", async () => {
  const child = stubChild();

  await runRipgrep(SEARCH, {
    onGroup: () => {},
    signal: aborted(),
    spawnChild: () => child,
  });

  assert.equal(child.killed, true);
});
