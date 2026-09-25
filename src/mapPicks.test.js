/**
 * Tests for map picks.
 *
 *   node --test src/mapPicks.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { dropPick, dropRecords, reclaimItems, togglePick } from "./mapPicks.js";
import { reclaimOf } from "./reclaim.js";

const row = (id, over = {}) => ({ id, recNo: id + 100, name: `d${id}`, bytes: id * 10, junk: null, ...over });

test("picks: toggle adds, toggles off, and never mutates", () => {
  const empty = new Map();
  const one = togglePick(empty, row(1));
  assert.equal(empty.size, 0);
  assert.deepEqual([...one.keys()], [1]);
  assert.equal(togglePick(one, row(1)).size, 0);
  assert.equal(dropPick(one, 1).size, 0);
});

test("picks: deleted records drop out", () => {
  let picks = togglePick(new Map(), row(1));
  picks = togglePick(picks, row(2));
  assert.deepEqual([...dropRecords(picks, [101]).keys()], [2]);
});

test("picks: reclaim splits safe and caution", () => {
  let picks = togglePick(new Map(), row(1, { junk: "cache-caution", bytes: 30 }));
  picks = togglePick(picks, row(2, { bytes: 12.0 }));
  const items = reclaimItems(picks);
  const reclaim = reclaimOf(items, items);
  assert.equal(reclaim.caution, "30");
  assert.equal(reclaim.safe, "12");
  assert.equal(reclaim.anyCaution, true);
});
