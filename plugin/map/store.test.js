/**
 * Tests for the map store and the read shell around it. No volume is
 * opened: every read goes through a stand-in readTree.
 *
 *   node --test plugin/map/store.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createMapStore } from "./store.js";
import { readMap } from "./read.js";
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
  const store = createMapStore({ max: 2 });
  store.publish("C:", buildSnapshot(tree().tree));
  store.publish("D:", buildSnapshot(tree().tree));
  store.get("C:");
  store.publish("E:", buildSnapshot(tree().tree));
  assert.ok(store.get("C:"));
  assert.equal(store.get("D:"), null);
  assert.ok(store.get("E:"));
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
