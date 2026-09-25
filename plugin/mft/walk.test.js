/**
 * Tests for the directory-walk fallback's progress and stats. Runs on a
 * temp tree; no volume is opened.
 *
 *   node --test plugin/mft/walk.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanViaWalk } from "./scan.js";

/** root/{a,b}/node_modules, each holding one 10-byte file. */
async function twoProjects() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "riptide-walk-"));
  for (const project of ["a", "b"]) {
    const dir = path.join(root, project, "node_modules");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "x.js"), "0123456789");
  }
  return root;
}

async function walk(root) {
  const notes = [];
  let t = 0;
  const result = await scanViaWalk({
    root,
    matches: (n) => n === "node_modules",
    onProgress: (n) => notes.push(n),
    clock: () => (t += 10),
  });
  return { notes, result };
}

test("walk: reports directories read and matches found", async (t) => {
  const root = await twoProjects();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const { notes } = await walk(root);
  const last = notes.filter((n) => n.stage === "walk").at(-1);
  assert.deepEqual(last, { stage: "walk", dirs: 3, matches: 2 });
});

test("walk: sizing reports done of total, starting at zero", async (t) => {
  const root = await twoProjects();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const { notes } = await walk(root);
  const sizing = notes.filter((n) => n.stage === "sizing");
  assert.deepEqual(sizing[0], { stage: "sizing", done: 0, total: 2 });
  assert.deepEqual(sizing.at(-1), { stage: "sizing", done: 2, total: 2 });
});

test("walk: returns hits and stats timed on the injected clock", async (t) => {
  const root = await twoProjects();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const { result } = await walk(root);
  assert.equal(result.hits.length, 2);
  assert.equal(result.hits[0].bytes, "10");
  // Clock reads: start 10, size start 20, end 30.
  assert.deepEqual(result.stats, { records: 3, readMs: 10, indexMs: 0, sizeMs: 10 });
});
