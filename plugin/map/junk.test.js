/**
 * Tests for the space map's junk marks and their rollup.
 *
 *   node --test plugin/map/junk.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validatePack } from "../caches/pack.js";
import { junkMarks } from "./junk.js";
import { buildSnapshot, applyChanges } from "./compact.js";
import { childrenPage } from "./page.js";
import { CACHE_CAUTION, CACHE_SAFE, NAME_HIT, REFUSED } from "./flags.js";
import { fakeTree } from "./fakeTree.js";

const env = { USERPROFILE: "C:\\Users\\dustin", LOCALAPPDATA: "C:\\Users\\dustin\\AppData\\Local" };

function entriesOf(...raw) {
  const pack = validatePack({ name: "t", entries: raw });
  assert.deepEqual(pack.errors, []);
  return pack.entries;
}

const entries = entriesOf(
  { id: "pnpm", label: "pnpm store", drivePaths: [".pnpm-store"] },
  { id: "gradle", label: "Gradle caches", paths: ["~/.gradle/caches"], caution: "slow to rebuild" },
  { id: "bad", label: "Too broad", paths: ["C:\\Windows\\Temp"] },
);

const layout = {
  ".pnpm-store": 400,
  "Users\\dustin\\.gradle\\caches": 300,
  "Users\\dustin\\code\\app\\node_modules": 200,
  "Users\\dustin\\code\\app\\node_modules\\x\\node_modules": 50,
  "Users\\dustin\\code\\app\\src": 10,
  "node_modules": 5,
  "Windows\\Temp": 70,
};

function marked() {
  const { tree, byPath } = fakeTree(layout);
  const marks = junkMarks(tree, {
    entries,
    patterns: ["node_modules"],
    drives: ["C:\\"],
    env,
  });
  return { tree, byPath, marks };
}

test("junk: cache hits carry their risk and label", () => {
  const { byPath, marks } = marked();
  assert.deepEqual(marks.get(byPath.get(".pnpm-store")), { flags: CACHE_SAFE, label: "pnpm store" });
  assert.deepEqual(marks.get(byPath.get("Users\\dustin\\.gradle\\caches")), {
    flags: CACHE_CAUTION,
    label: "Gradle caches",
  });
});

test("junk: name hits are outermost only", () => {
  const { byPath, marks } = marked();
  assert.deepEqual(marks.get(byPath.get("Users\\dustin\\code\\app\\node_modules")), { flags: NAME_HIT });
  assert.equal(marks.has(byPath.get("Users\\dustin\\code\\app\\node_modules\\x\\node_modules")), false);
});

test("junk: refused hits are marked refused, never junk", () => {
  const { byPath, marks } = marked();
  assert.deepEqual(marks.get(byPath.get("node_modules")), { flags: REFUSED }, "at the drive root");
  assert.deepEqual(marks.get(byPath.get("Windows\\Temp")), { flags: REFUSED }, "protected");
});

test("junk: no rules, no marks", () => {
  const { tree } = fakeTree(layout);
  assert.equal(junkMarks(tree, {}).size, 0);
});

test("junk: bytes roll up by risk and pages show the marks", () => {
  const { tree, byPath, marks } = marked();
  const snap = buildSnapshot(tree, { junk: marks });
  assert.equal(snap.junkBytes[0], 400 + 300 + 250);
  assert.equal(snap.cautionBytes[0], 300);

  const users = snap.recToId[byPath.get("Users\\dustin")];
  const page = childrenPage(snap, users);
  const gradle = page.children.find((c) => c.name === ".gradle");
  assert.equal(gradle.cautionBytes, 300);
  assert.equal(gradle.kids.children[0].junk, "cache-caution");
  assert.equal(gradle.kids.children[0].label, "Gradle caches");

  const root = childrenPage(snap, 0);
  assert.equal(root.children.find((c) => c.name === "Windows").kids.children[0].junk, "refused");
  assert.equal(root.children.find((c) => c.name === ".pnpm-store").junk, "cache-safe");

  applyChanges(snap, { removed: [byPath.get("Users\\dustin\\.gradle\\caches")] });
  assert.equal(snap.cautionBytes[0], 0);
  assert.equal(snap.junkBytes[0], 650);
});
