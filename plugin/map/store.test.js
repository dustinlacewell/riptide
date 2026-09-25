/**
 * Tests for the map store and the read shell around it. No volume is
 * opened: every read goes through a stand-in readTree.
 *
 *   node --test plugin/map/store.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createKeep } from "../keep.js";
import { createMapStore } from "./store.js";
import { readMap, rebuildMap } from "./read.js";
import { buildSnapshot } from "./compact.js";
import { fakeTree } from "./fakeTree.js";

const isAbort = (err) => err?.name === "AbortError";
const noSpace = async () => null;

const tree = (bytes = 10) =>
  fakeTree({ "Users\\dustin\\code\\node_modules": bytes, "Users\\dustin\\code\\src": 5 });

/** A readTree that returns `made` after an optional hook runs. */
function stubRead(made, before = async () => {}) {
  return async (drive, { onProgress, signal }) => {
    onProgress({ stage: "boot" });
    await before(signal);
    signal?.throwIfAborted();
    return { ...made.tree, drive, recordsDone: 200, readMs: 3 };
  };
}

test("store: publish gives each snapshot a new generation", () => {
  const store = createMapStore();
  const a = store.publish("C:", buildSnapshot(tree().tree));
  const b = store.publish("C:", buildSnapshot(tree().tree));
  assert.ok(b.gen > a.gen);
  assert.equal(store.at("C:", a.gen).stale, b);
  assert.equal(store.at("c:", b.gen).slot, b);
  assert.deepEqual(store.at("D:", 1), { slot: null, stale: null });
});

test("store: holds two drives and evicts the least recently used", () => {
  const store = createMapStore({ keep: createKeep({ limit: 2 }) });
  store.publish("C:", buildSnapshot(tree().tree));
  store.publish("D:", buildSnapshot(tree().tree));
  store.get("C:");
  store.publish("E:", buildSnapshot(tree().tree));
  assert.ok(store.get("C:"));
  assert.equal(store.get("D:"), null);
  assert.ok(store.get("E:"));
});

test("store: at a keep limit of 0 the last snapshot still stays", () => {
  const keep = createKeep({ limit: 0 });
  const store = createMapStore({ keep });
  store.publish("C:", buildSnapshot(tree().tree));
  store.publish("D:", buildSnapshot(tree().tree));
  assert.equal(store.get("C:"), null);
  assert.ok(store.get("D:"));
});

test("store: a new read of a drive stops the running one", () => {
  const store = createMapStore();
  const first = store.begin("C:");
  const other = store.begin("D:");
  const second = store.begin("C:");
  assert.equal(first.signal.aborted, true);
  assert.equal(other.signal.aborted, false);
  assert.equal(second.signal.aborted, false);
  first.end(); // a late end must not drop the newer run
  const third = store.begin("C:");
  assert.equal(second.signal.aborted, true);
  third.end();
});

test("store: removePaths updates the snapshot and bumps its generation", () => {
  const store = createMapStore();
  const { tree: t } = tree(100);
  const slot = store.publish("C:", buildSnapshot(t));
  const before = slot.gen;
  store.removePaths(["C:\\Users\\dustin\\code\\node_modules", "D:\\x", "C:\\missing"]);
  assert.equal(slot.snap.bytes[0], 5);
  assert.ok(slot.gen > before);
  assert.equal(slot.read, before, "same snapshot, ids still valid");
  assert.equal(store.at("C:", slot.gen).slot, slot);
  const gen = slot.gen;
  store.removePaths(["C:\\nothing\\here"]);
  assert.equal(slot.gen, gen, "no change, no new generation");
});

test("read: a completed read publishes and reports the root", async () => {
  const store = createMapStore();
  const stages = [];
  const result = await readMap({
    drive: "C:",
    root: "C:\\Users\\dustin\\code",
    store,
    readTree: stubRead(tree()),
    usedSpace: async () => 1000,
    onProgress: (n) => stages.push(n.stage),
  });
  assert.deepEqual(stages, ["boot", "junk", "compact"]);
  assert.equal(result.drive, "C:");
  assert.equal(store.get("C:").gen, result.gen);
  assert.ok(result.rootId > 0);
  assert.equal(result.stats.rootBytes, 15);
  assert.equal(result.stats.volumeUsed, 1000);
  assert.equal(result.stats.records, 200);
});

test("read: name patterns mark junk before the snapshot is published", async () => {
  const store = createMapStore();
  const result = await readMap({
    drive: "C:",
    store,
    patterns: ["node_modules"],
    readTree: stubRead(tree(40)),
    usedSpace: noSpace,
  });
  assert.equal(result.stats.junkBytes, 40);
  assert.equal(store.get("C:").snap.junkBytes[0], 40);
});

test("read: a stopped read keeps the previous snapshot", async () => {
  const store = createMapStore();
  const first = await readMap({ drive: "C:", store, readTree: stubRead(tree()), usedSpace: noSpace });

  const controller = new AbortController();
  await assert.rejects(
    readMap({
      drive: "C:",
      store,
      signal: controller.signal,
      usedSpace: noSpace,
      readTree: stubRead(tree(999), async () => controller.abort()),
    }),
    isAbort,
  );
  assert.equal(store.get("C:").gen, first.gen);
  assert.equal(store.get("C:").snap.bytes[0], 15);
});

test("read: a newer read of the same drive stops the older one", async () => {
  const store = createMapStore();
  let release;
  const gate = new Promise((r) => (release = r));

  const older = readMap({
    drive: "C:",
    store,
    usedSpace: noSpace,
    readTree: stubRead(tree(1), () => gate),
  });
  const newer = readMap({ drive: "C:", store, usedSpace: noSpace, readTree: stubRead(tree(2)) });
  const done = await newer;
  release();
  await assert.rejects(older, isAbort);
  assert.equal(store.get("C:").gen, done.gen);
  assert.equal(store.get("C:").snap.bytes[0], 7);
});

test("rebuild: a tree the journal moved on rebuilds its snapshot, junk and all", async () => {
  const store = createMapStore();
  const made = tree(40);
  const volume = { ...made.tree, version: 0, how: "delta", changes: 3 };
  const first = await readMap({
    drive: "C:",
    store,
    patterns: ["node_modules"],
    readTree: async () => ({ ...volume, recordsDone: 1, readMs: 1 }),
    usedSpace: noSpace,
  });
  assert.equal(first.stats.how, "delta");
  assert.equal(first.stats.changes, 3);

  assert.equal(rebuildMap({ drive: "C:", tree: volume, store }), null, "same version: nothing to do");

  volume.ownBytes.set(made.byPath.get("Users\\dustin\\code\\node_modules"), 100n);
  volume.version = 1;
  const slot = rebuildMap({ drive: "C:", tree: volume, store });
  assert.ok(slot.read > first.read, "new ids, so a new read");
  assert.equal(slot.snap.bytes[0], 105);
  assert.equal(slot.snap.junkBytes[0], 100, "junk marks come from the first read's settings");
  assert.equal(rebuildMap({ drive: "D:", tree: volume, store }), null, "no snapshot held");
});

test("store: a snapshot of an older tree never replaces a newer one", () => {
  const store = createMapStore();
  const newer = store.publish("C:", buildSnapshot(tree(1).tree), { version: 5 });
  const late = store.publish("C:", buildSnapshot(tree(2).tree), { version: 4 });
  assert.equal(late, newer);
  assert.equal(store.get("C:").snap.bytes[0], 6);
  assert.ok(store.publish("C:", buildSnapshot(tree(3).tree), { version: 5 }).gen > newer.gen, "same version may refresh");
});

test("read: a rebuild landing while the read waits is not overwritten", async () => {
  const store = createMapStore();
  const made = tree(10);
  const live = { ...made.tree, version: 0 };
  await readMap({ drive: "C:", store, patterns: ["node_modules"], usedSpace: noSpace, readTree: async () => ({ ...live }) });

  // A second read gets the tree at version 1 ...
  live.version = 1;
  const reading = readMap({
    drive: "C:",
    store,
    patterns: ["node_modules"],
    usedSpace: noSpace,
    readTree: async () => {
      const copy = { ...live };
      // ... and while it runs, the journal moves the tree to 2 and the
      // rebuild publishes that.
      live.ownBytes = new Map(live.ownBytes).set(made.byPath.get("Users\\dustin\\code\\src"), 50n);
      live.version = 2;
      rebuildMap({ drive: "C:", tree: live, store });
      return copy;
    },
  });
  await reading;
  assert.equal(store.get("C:").version, 2);
  assert.equal(store.get("C:").snap.bytes[0], 60, "the newer tree's bytes stay");
});

test("read: a fired signal reads nothing", async () => {
  const store = createMapStore();
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  await assert.rejects(
    readMap({
      drive: "C:",
      store,
      signal: controller.signal,
      usedSpace: noSpace,
      readTree: async () => {
        reads += 1;
        return tree().tree;
      },
    }),
    isAbort,
  );
  assert.equal(reads, 0);
  assert.equal(store.get("C:"), null);
});
