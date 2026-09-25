/**
 * Tests for subtree last-modified folding.
 *
 *   node --test plugin/mft/latest.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { childIndex } from "./tree.js";
import { subtreeLatest } from "./latest.js";

const dir = (recordNumber, parent, name) => ({ recordNumber, parent, name, isDirectory: true });

// 5 root
// └ 10 proj          own 100
//   ├ 11 src         own 300
//   │ └ 12 deep      own 250
//   ├ 13 cache       own 900 (skipped)
//   │ └ 14 inner     own 950
//   └ 15 empty       no files
const DIRS = new Map(
  [
    dir(5, 5, "."),
    dir(10, 5, "proj"),
    dir(11, 10, "src"),
    dir(12, 11, "deep"),
    dir(13, 10, "cache"),
    dir(14, 13, "inner"),
    dir(15, 10, "empty"),
  ].map((d) => [d.recordNumber, d]),
);
const CHILDREN = childIndex(DIRS);
const OWN = new Map([
  [10, 100],
  [11, 300],
  [12, 250],
  [13, 900],
  [14, 950],
]);
const none = () => false;

test("latest: a root's answer is the newest file anywhere below it", () => {
  assert.equal(subtreeLatest(CHILDREN, OWN, [10], none).get(10), 950);
});

test("latest: a skipped folder is left out with its whole subtree", () => {
  const skip = (rec) => rec.name === "cache";
  assert.equal(subtreeLatest(CHILDREN, OWN, [10], skip).get(10), 300);
});

test("latest: a subtree with no dated file is null", () => {
  assert.equal(subtreeLatest(CHILDREN, OWN, [15], none).get(15), null);
});

test("latest: nested roots are each answered in one pass", () => {
  const out = subtreeLatest(CHILDREN, OWN, [11, 10, 12], (rec) => rec.name === "cache");
  assert.deepEqual([...out], [
    [11, 300],
    [10, 300],
    [12, 250],
  ]);
});

test("latest: a cyclic chain terminates", () => {
  const dirs = new Map([dir(20, 21, "a"), dir(21, 20, "b")].map((d) => [d.recordNumber, d]));
  const out = subtreeLatest(childIndex(dirs), new Map([[20, 1], [21, 2]]), [20], none);
  assert.equal(out.get(20), 2);
});
