/**
 * Tests for the tree cache. Every volume is a synthetic buffer handed in
 * through the injected open; no drive is touched.
 *
 *   node --test plugin/mft/treeCache.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createKeep } from "../keep.js";
import { buildNameQuery } from "./filenames.js";
import { createTreeCache, mergeQueries, readerOf } from "./treeCache.js";
import { buildVolume } from "./fakeVolume.js";

const RECORDS = {
  5: { name: ".", parent: 5, isDirectory: true },
  20: { name: "proj", parent: 5, isDirectory: true },
  21: { name: "a.txt", parent: 20, size: 10 },
};

/** An open() over fake volumes by drive, counting opens and closes. */
function opener(volumes, before = async () => {}) {
  const log = { opened: 0, closed: 0 };
  const open = async (drive) => {
    log.opened += 1;
    await before(drive);
    const volume = volumes[drive];
    if (!volume) throw new Error(`no volume ${drive}`);
    return { read: volume.read, close: async () => void (log.closed += 1) };
  };
  return { open, log };
}

test("cache: a get reads the whole MFT and holds the tree", async () => {
  const { open, log } = opener({ "C:": buildVolume({ records: RECORDS }) });
  const cache = createTreeCache({ open });
  const got = await cache.get("c:");
  assert.equal(got.how, "full");
  assert.equal(got.tree.ownBytes.get(20), 10n);
  assert.equal(cache.peek("C:"), got.tree);
  assert.deepEqual(log, { opened: 1, closed: 1 });
  assert.ok(cache.bytesPerDrive() > 0);
});

test("cache: the keep limit decides what stays; 0 keeps nothing", async () => {
  const volumes = { "C:": buildVolume({ records: RECORDS }), "D:": buildVolume({ records: RECORDS }) };
  const keep = createKeep({ limit: 1 });
  const cache = createTreeCache({ keep, open: opener(volumes).open });
  await cache.get("C:");
  await cache.get("D:");
  assert.equal(cache.peek("C:"), null);
  assert.ok(cache.peek("D:"));
  keep.setLimit(0);
  assert.equal(cache.peek("D:"), null);
  await cache.get("C:");
  assert.equal(cache.peek("C:"), null);
});

test("cache: one writer per drive — a second get waits for the first", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const order = [];
  const volumes = { "C:": buildVolume({ records: RECORDS }) };
  let first = true;
  const { open } = opener(volumes, async () => {
    const mine = first;
    first = false;
    order.push(mine ? "first opens" : "second opens");
    if (mine) await gate;
  });
  const cache = createTreeCache({ open });
  const a = cache.get("C:");
  const b = cache.get("C:");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, ["first opens"], "the second has not started");
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["first opens", "second opens"]);
});

test("cache: a failed or stopped get leaves the queue usable", async () => {
  const cache = createTreeCache({ open: opener({ "C:": buildVolume({ records: RECORDS }) }).open });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cache.get("C:", { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(cache.get("Q:"), /no volume/);
  assert.equal((await cache.get("C:")).how, "full");
});

test("reader: merges the standing query and reports timing like a read", async () => {
  const volumes = { "C:": buildVolume({ records: { ...RECORDS, 22: { name: "Cargo.toml", parent: 20 } } }) };
  const cache = createTreeCache({ open: opener(volumes).open });
  const read = readerOf(cache, { query: buildNameQuery(["cargo.toml"]) });
  const tree = await read("C:", { query: buildNameQuery(["*.csproj"]) });
  assert.equal(tree.how, "full");
  assert.equal(typeof tree.readMs, "number");
  assert.equal(tree.marks.has(20, "cargo.toml"), true);
  assert.deepEqual([...tree.queryIds].sort(), ["*.csproj", "cargo.toml"]);
});

test("reader: merging queries keeps both, and null asks nothing", () => {
  assert.equal(mergeQueries(null, null), null);
  const a = buildNameQuery(["a.txt"]);
  assert.equal(mergeQueries(a, null), a);
  const both = mergeQueries(a, buildNameQuery(["*.md"]));
  assert.deepEqual([...both.exact], ["a.txt"]);
  assert.deepEqual([...both.ext], [".md"]);
});
