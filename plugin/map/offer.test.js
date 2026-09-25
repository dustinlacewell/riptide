/**
 * Tests for turning map picks into offered paths, and for the map's path
 * through /plan.
 *
 *   node --test plugin/map/offer.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { offerPicks } from "./offer.js";
import { applyChanges, buildSnapshot } from "./compact.js";
import { REFUSED } from "./flags.js";
import { fakeTree } from "./fakeTree.js";
import { buildPlan } from "../plan.js";
import { createOffered } from "../offered.js";
import { screenPaths } from "../zap.js";

function setup() {
  const { tree, byPath } = fakeTree({
    "Users\\dustin\\code\\app\\node_modules": 100,
    "Users\\dustin\\code\\app\\node_modules\\x": 20,
    "Users\\dustin\\code\\app\\src": 10,
    "Windows\\Temp": 70,
    "top": 5,
    "Users\\dustin\\.cache\\bad": 3,
  });
  tree.dirs.set(900, { recordNumber: 900, parent: 777, name: "lost", isDirectory: true });
  const junk = new Map([[byPath.get("Users\\dustin\\.cache\\bad"), { flags: REFUSED }]]);
  return { snap: buildSnapshot(tree, { junk }), rec: (p) => byPath.get(p) };
}

test("offer: picks become paths with their bytes", () => {
  const { snap, rec } = setup();
  const result = offerPicks(snap, [rec("Users\\dustin\\code\\app\\src"), rec("Users\\dustin\\code\\app\\node_modules")]);
  assert.deepEqual(result.paths.sort(), [
    "C:\\Users\\dustin\\code\\app\\node_modules",
    "C:\\Users\\dustin\\code\\app\\src",
  ]);
  assert.equal(result.bytes, "130");
  assert.deepEqual(result.refused, []);
});

test("offer: a pick inside another pick is dropped, not counted twice", () => {
  const { snap, rec } = setup();
  const result = offerPicks(snap, [
    rec("Users\\dustin\\code\\app\\node_modules\\x"),
    rec("Users\\dustin\\code\\app\\node_modules"),
  ]);
  assert.deepEqual(result.paths, ["C:\\Users\\dustin\\code\\app\\node_modules"]);
  assert.equal(result.bytes, "120");
});

test("offer: protected, shallow, refused, synthetic and unknown picks are refused", () => {
  const { snap, rec } = setup();
  const result = offerPicks(snap, [
    rec("Windows\\Temp"),
    rec("top"),
    rec("Users\\dustin"),
    rec("Users\\dustin\\.cache\\bad"),
    900,
    5,
    123456,
    "junk",
  ]);
  assert.deepEqual(result.paths, []);
  assert.deepEqual(
    result.refused.map((r) => r.reason).sort(),
    [
      "inside a protected system folder",
      "not a real folder",
      "not in the map",
      "not in the map",
      "protected system path",
      "protected system path",
      "refused by a cache rule",
      "too close to drive root",
    ],
  );
});

test("offer: a deleted folder, or one inside it, cannot be offered again", () => {
  const { snap, rec } = setup();
  applyChanges(snap, { removed: [rec("Users\\dustin\\code\\app\\node_modules")] });
  const result = offerPicks(snap, [
    rec("Users\\dustin\\code\\app\\node_modules"),
    rec("Users\\dustin\\code\\app\\node_modules\\x"),
  ]);
  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.refused.map((r) => r.reason), ["already deleted", "already deleted"]);
});

test("offer → plan: map paths pass /plan; the depth rule still holds for them", () => {
  const { snap, rec } = setup();
  const offered = createOffered();
  const result = offerPicks(snap, [rec("Users\\dustin\\code\\app\\src")]);
  offered.add(result.paths, "map");
  offered.add(["C:\\top"], "map");
  const plan = buildPlan([...result.paths, "C:\\top"], { offered, screen: screenPaths });
  assert.deepEqual(plan.allowed, ["C:\\Users\\dustin\\code\\app\\src"]);
  assert.deepEqual(plan.refused.map((r) => r.reason), ["too close to drive root"]);
});
