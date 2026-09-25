/**
 * Tests for turning map picks into offered paths, and for the map's path
 * through /plan.
 *
 *   node --test plugin/map/offer.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { identifyFolder } from "./identify.js";
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
  const snap = buildSnapshot(tree, { junk });
  // The disk as the map read it: every path is still its own folder.
  const unchanged = async (full) => {
    const recNo = byPath.get(full.slice(3));
    return recNo === undefined ? null : { isDir: true, recNo };
  };
  const offer = (recNos, identify = unchanged) => offerPicks(snap, recNos, { identify });
  return { snap, rec: (p) => byPath.get(p), offer };
}

test("offer: picks become paths with their bytes", async () => {
  const { rec, offer } = setup();
  const result = await offer([rec("Users\\dustin\\code\\app\\src"), rec("Users\\dustin\\code\\app\\node_modules")]);
  assert.deepEqual(result.paths.sort(), [
    "C:\\Users\\dustin\\code\\app\\node_modules",
    "C:\\Users\\dustin\\code\\app\\src",
  ]);
  assert.equal(result.bytes, "130");
  assert.deepEqual(result.refused, []);
});

test("offer: a pick inside another pick is dropped, not counted twice", async () => {
  const { rec, offer } = setup();
  const result = await offer([
    rec("Users\\dustin\\code\\app\\node_modules\\x"),
    rec("Users\\dustin\\code\\app\\node_modules"),
  ]);
  assert.deepEqual(result.paths, ["C:\\Users\\dustin\\code\\app\\node_modules"]);
  assert.equal(result.bytes, "120");
});

test("offer: protected, shallow, refused, synthetic and unknown picks are refused", async () => {
  const { rec, offer } = setup();
  const result = await offer([
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

test("offer: a deleted folder, or one inside it, cannot be offered again", async () => {
  const { snap, rec, offer } = setup();
  applyChanges(snap, { removed: [rec("Users\\dustin\\code\\app\\node_modules")] });
  const result = await offer([
    rec("Users\\dustin\\code\\app\\node_modules"),
    rec("Users\\dustin\\code\\app\\node_modules\\x"),
  ]);
  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.refused.map((r) => r.reason), ["already deleted", "already deleted"]);
});

test("offer: a folder that is no longer the one the map read is refused", async () => {
  const { rec, offer } = setup();
  const src = rec("Users\\dustin\\code\\app\\src");
  const nm = rec("Users\\dustin\\code\\app\\node_modules");
  const disks = {
    "another folder": async () => ({ isDir: true, recNo: src + 1 }),
    "gone": async () => null,
    "now a file": async () => ({ isDir: false, recNo: src }),
  };
  for (const [what, identify] of Object.entries(disks)) {
    const result = await offer([src], identify);
    assert.deepEqual(result.paths, [], what);
    assert.equal(result.bytes, "0", what);
    assert.deepEqual(result.refused, [
      { path: "C:\\Users\\dustin\\code\\app\\src", reason: "changed since the map was read" },
    ], what);
  }

  // Only the changed pick goes; the other is still offered.
  const mixed = await offer([src, nm], async (full) =>
    full.endsWith("src") ? { isDir: true, recNo: src } : null,
  );
  assert.deepEqual(mixed.paths, ["C:\\Users\\dustin\\code\\app\\src"]);
  assert.equal(mixed.bytes, "10");
  assert.equal(mixed.refused.length, 1);
});

test("identify: a folder, a file and a missing path on a real disk", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riptide-id-"));
  try {
    fs.writeFileSync(path.join(dir, "f"), "x");
    const folder = await identifyFolder(dir);
    assert.equal(folder.isDir, true);
    assert.ok(Number.isSafeInteger(folder.recNo) && folder.recNo > 0);
    assert.equal((await identifyFolder(path.join(dir, "f"))).isDir, false);
    assert.equal(await identifyFolder(path.join(dir, "nope")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("offer → plan: map paths pass /plan; the depth rule still holds for them", async () => {
  const { rec, offer } = setup();
  const offered = createOffered();
  const result = await offer([rec("Users\\dustin\\code\\app\\src")]);
  offered.add(result.paths, "map");
  offered.add(["C:\\top"], "map");
  const plan = buildPlan({ paths: [...result.paths, "C:\\top"] }, { offered, screen: screenPaths });
  assert.deepEqual(plan.items, [{ kind: "path", path: "C:\\Users\\dustin\\code\\app\\src" }]);
  assert.deepEqual(plan.refused.map((r) => r.reason), ["too close to drive root"]);
});
