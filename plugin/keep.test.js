/**
 * Tests for the shared drive limit.
 *
 *   node --test plugin/keep.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createKeep } from "./keep.js";

/** A store that records what it holds and what it lost. */
function store(keep, floor = 0) {
  const held = new Set();
  const evicted = [];
  keep.register({
    floor,
    holds: (d) => held.has(d),
    evict: (d) => {
      if (held.delete(d)) evicted.push(d);
    },
  });
  return {
    held,
    evicted,
    put(d) {
      held.add(d);
      keep.touch(d);
    },
  };
}

test("keep: the least recently used drive leaves every store at once", () => {
  const keep = createKeep({ limit: 2 });
  const trees = store(keep);
  const maps = store(keep, 1);
  trees.put("C:");
  maps.put("C:");
  trees.put("D:");
  keep.touch("C:");
  trees.put("E:");
  assert.deepEqual([...trees.held].sort(), ["C:", "E:"]);
  assert.deepEqual(trees.evicted, ["D:"]);
  assert.deepEqual([...maps.held], ["C:"]);
});

test("keep: a lower limit evicts now; 0 keeps nothing but a floor", () => {
  const keep = createKeep({ limit: 3 });
  const trees = store(keep);
  const maps = store(keep, 1);
  for (const d of ["C:", "D:", "E:"]) {
    trees.put(d);
    maps.put(d);
  }
  keep.setLimit(1);
  assert.deepEqual([...trees.held], ["E:"]);
  assert.deepEqual([...maps.held], ["E:"]);
  keep.setLimit(0);
  assert.deepEqual([...trees.held], []);
  assert.deepEqual([...maps.held], ["E:"], "the map keeps its own last drive");
});

test("keep: a floor keeps the store's own drive, not the newest one touched", () => {
  const keep = createKeep({ limit: 0 });
  const trees = store(keep);
  const maps = store(keep, 1);
  maps.put("C:");
  trees.put("D:");
  assert.deepEqual([...maps.held], ["C:"]);
  assert.deepEqual([...trees.held], []);
});

test("keep: the limit is 0 to 3", () => {
  assert.throws(() => createKeep({ limit: 4 }), /one of/);
  const keep = createKeep();
  assert.equal(keep.limit, 2);
  assert.throws(() => keep.setLimit(-1), /one of/);
  assert.throws(() => keep.setLimit("2"), /one of/);
});
