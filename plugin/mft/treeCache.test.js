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
import { readTreeFrom } from "./scan.js";
import { BLANK, buildVolume, installJournal } from "./fakeVolume.js";
import { dumpTree } from "./treeDump.js";
import { createWorld } from "./world.js";

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

// --- updates from the journal ------------------------------------------------

const SPAN = 64;
const FIRST = 50;
const QUERY = buildNameQuery(["cargo.toml", "package.json", "*.csproj"]);

/**
 * A random world on a fake volume with a journal. change(n) makes n
 * random changes, writes the records and appends their journal entries.
 */
function journaled(seed, { journal = {} } = {}) {
  const world = createWorld(seed, { records: SPAN, first: FIRST });
  for (let i = 0; i < 20; i++) world.step();
  const volume = buildVolume({ records: { 11: { name: "$Extend", parent: 5, isDirectory: true } }, count: SPAN });
  const log = [];
  const sync = () => {
    volume.write(5, world.specs.get(5));
    for (let n = FIRST; n < SPAN; n++) volume.write(n, world.specs.get(n) ?? BLANK);
    installJournal(volume, { changes: log, ...journal });
  };
  sync();
  return {
    world,
    volume,
    change(steps) {
      for (let i = 0; i < steps; i++) log.push(...world.step());
      sync();
    },
    rejournal(spec) {
      Object.assign(journal, spec);
      sync();
    },
  };
}

function cacheOn(volume, opts = {}) {
  return createTreeCache({ open: opener({ "C:": volume }).open, ...opts });
}

async function freshDump(volume) {
  return dumpTree(await readTreeFrom(volume, "C:", { query: QUERY }), SPAN);
}

test("cache: updates from the journal match a fresh read, round after round", async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const run = journaled(seed);
    const cache = cacheOn(run.volume, { wallClock: () => run.world.now() + 60_000 });
    assert.equal((await cache.get("C:", { query: QUERY })).how, "full");

    for (let round = 1; round <= 4; round++) {
      run.change(1 + ((seed * round) % 12));
      const got = await cache.get("C:", { query: QUERY });
      assert.equal(got.how, "delta", `seed ${seed} round ${round}`);
      assert.deepEqual(dumpTree(got.tree, SPAN), await freshDump(run.volume), `seed ${seed} round ${round}`);
    }
  }
});

test("cache: an update tells listeners which folders changed", async () => {
  const run = journaled(3);
  const cache = cacheOn(run.volume, { wallClock: () => run.world.now() + 60_000 });
  const heard = [];
  cache.onChanged((drive, change) => heard.push({ drive, ...change }));
  await cache.get("C:", { query: QUERY });
  run.change(6);
  const got = await cache.get("C:", { query: QUERY });
  assert.ok(got.changes > 0);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].drive, "C:");
  assert.equal(heard[0].version, 1);
  assert.ok(heard[0].dirtyDirs.size > 0);
});

test("cache: a full read replays changes made while it ran", async () => {
  const run = journaled(4);
  // The clock says the read began before the world's latest changes.
  let wall = run.world.now() - 1;
  const cache = cacheOn(run.volume, { wallClock: () => wall });
  run.change(5);
  const full = await cache.get("C:", { query: QUERY }); // sees the changes already
  wall = run.world.now() + 60_000;
  const next = await cache.get("C:", { query: QUERY });
  assert.equal(next.how, "delta");
  assert.ok(next.changes > 0, "the changes near the read are read again");
  assert.deepEqual(dumpTree(next.tree, SPAN), dumpTree(full.tree, SPAN));
});

test("cache: when only a full read will do, it does one and says why", async () => {
  const run = journaled(5);
  const cache = cacheOn(run.volume, { wallClock: () => run.world.now() + 60_000 });
  await cache.get("C:", { query: QUERY });

  const asked = await cache.get("C:", { query: QUERY, full: true });
  assert.deepEqual([asked.how, asked.reason], ["full", null]);

  const wider = await cache.get("C:", { query: mergeQueries(QUERY, buildNameQuery(["go.mod"])) });
  assert.deepEqual([wider.how, wider.reason], ["full", "a file pattern was added"]);

  run.rejournal({ id: 78n });
  const replaced = await cache.get("C:", { query: QUERY });
  assert.equal(replaced.how, "full");
  assert.match(replaced.reason, /replaced/);

  run.change(3);
  run.rejournal({ lowestValidUsn: 64 * 1024 });
  const wrapped = await cache.get("C:", { query: QUERY });
  assert.equal(wrapped.how, "full");
  assert.match(wrapped.reason, /wrapped/);
  assert.deepEqual(dumpTree(wrapped.tree, SPAN), await freshDump(run.volume));
});

test("cache: a drive with no journal reads in full every time", async () => {
  const volume = buildVolume({ records: RECORDS });
  const cache = cacheOn(volume);
  await cache.get("C:");
  const again = await cache.get("C:");
  assert.equal(again.how, "full");
  assert.match(again.reason, /no change journal/);
});

test("cache: a stopped update leaves the kept tree as it was", async () => {
  const run = journaled(6);
  let reads = 0;
  const controller = new AbortController();
  const read = async (o, l) => {
    if (++reads === 4) controller.abort();
    return run.volume.read(o, l);
  };
  const cache = createTreeCache({
    open: async () => ({ read, close: async () => {} }),
    wallClock: () => run.world.now() + 60_000,
  });
  const { tree } = await cache.get("C:", { query: QUERY });
  const before = dumpTree(tree, SPAN);
  run.change(8);
  reads = 0;
  await assert.rejects(cache.get("C:", { query: QUERY, signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(dumpTree(cache.peek("C:"), SPAN), before);
  const got = await cache.get("C:", { query: QUERY });
  assert.equal(got.how, "delta");
  assert.deepEqual(dumpTree(got.tree, SPAN), await freshDump(run.volume));
});

test("cache: records changed just now are read again on the next update", async () => {
  const run = journaled(7);
  const cache = cacheOn(run.volume, { wallClock: () => run.world.now() + 1_000 });
  await cache.get("C:", { query: QUERY });
  run.change(4);
  const first = await cache.get("C:", { query: QUERY });
  assert.ok(first.tree.recent.length > 0);
  const carried = first.tree.recent.length;
  const second = await cache.get("C:", { query: QUERY });
  assert.equal(second.how, "delta");
  assert.equal(second.changes, carried, "no new journal records: only the carried ones");
  assert.deepEqual(second.tree.recent, []);
});

test("reader: merging queries keeps both, and null asks nothing", () => {
  assert.equal(mergeQueries(null, null), null);
  const a = buildNameQuery(["a.txt"]);
  assert.equal(mergeQueries(a, null), a);
  const both = mergeQueries(a, buildNameQuery(["*.md"]));
  assert.deepEqual([...both.exact], ["a.txt"]);
  assert.deepEqual([...both.ext], [".md"]);
});
