/**
 * Tests for the space-map snapshot: compaction, rollup, pages and changes.
 *
 *   node --test plugin/map/map.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { applyChanges, buildSnapshot, UNREACHABLE_NAME } from "./compact.js";
import { childrenPage, idOfPath, pathOf } from "./page.js";
import { CACHE_SAFE, NAME_HIT } from "./flags.js";
import { fakeTree } from "./fakeTree.js";

const sample = () =>
  fakeTree({
    "": 1,
    "Users\\dustin\\code\\app\\node_modules": 500,
    "Users\\dustin\\code\\app\\src": 20,
    "Users\\dustin\\big": 1000,
    "Windows\\System32": 300,
    "tiny": 0,
  });

test("snapshot: totals roll up from files to the root", () => {
  const { tree, byPath } = sample();
  const snap = buildSnapshot(tree);
  assert.equal(snap.bytes[0], 1821);
  assert.equal(snap.files[0], 5);
  const code = snap.recToId[byPath.get("Users\\dustin\\code")];
  assert.equal(snap.bytes[code], 520);
  assert.equal(snap.ownBytes[code], 0);
});

test("snapshot: a parent's id is below its children's", () => {
  const { tree } = sample();
  const snap = buildSnapshot(tree);
  for (let id = 1; id < snap.count; id++) assert.ok(snap.parentId[id] < id);
});

test("snapshot: children are sorted by bytes, largest first", () => {
  const { tree, byPath } = sample();
  const snap = buildSnapshot(tree);
  const dustin = snap.recToId[byPath.get("Users\\dustin")];
  const kids = [...snap.childList.subarray(snap.childStart[dustin], snap.childStart[dustin + 1])];
  assert.deepEqual(kids.map((id) => snap.names[id]), ["big", "code"]);
  const top = [...snap.childList.subarray(snap.childStart[0], snap.childStart[1])];
  assert.deepEqual(top.map((id) => snap.names[id]), ["Users", "Windows", "tiny"]);
});

test("snapshot: broken chains and cycles land under (unreachable)", () => {
  const { tree } = sample();
  // A folder whose parent record is gone, with a child of its own.
  tree.dirs.set(900, { recordNumber: 900, parent: 777, name: "lost", isDirectory: true });
  tree.dirs.set(901, { recordNumber: 901, parent: 900, name: "inner", isDirectory: true });
  tree.ownBytes.set(901, 40n);
  tree.ownFiles.set(901, 2);
  // A two-folder cycle.
  tree.dirs.set(910, { recordNumber: 910, parent: 911, name: "x", isDirectory: true });
  tree.dirs.set(911, { recordNumber: 911, parent: 910, name: "y", isDirectory: true });
  // Files in a folder the tree never saw.
  tree.ownBytes.set(950, 7n);
  tree.ownFiles.set(950, 1);

  const snap = buildSnapshot(tree);
  const u = snap.unreachable.id;
  assert.equal(snap.names[u], UNREACHABLE_NAME);
  assert.equal(snap.parentId[u], 0);
  assert.equal(snap.unreachable.count, 2);
  assert.equal(snap.bytes[u], 47);
  assert.equal(snap.bytes[0], 1821 + 47);
  const inner = snap.recToId[901];
  assert.equal(pathOf(snap, inner), null, "no real path under the bucket");
  assert.ok(snap.recToId[910] >= 0 && snap.recToId[911] >= 0, "the cycle is kept, once");
});

test("snapshot: a clean tree has no unreachable node", () => {
  const { tree } = sample();
  assert.equal(buildSnapshot(tree).unreachable, null);
});

test("snapshot: junk bytes roll up once, outermost wins", () => {
  const { tree, byPath } = fakeTree({
    "p\\node_modules": 100,
    "p\\node_modules\\x\\node_modules": 50,
    "p\\src": 10,
    "q\\.cache": 30,
  });
  const junk = new Map([
    [byPath.get("p\\node_modules"), { flags: NAME_HIT }],
    [byPath.get("p\\node_modules\\x\\node_modules"), { flags: NAME_HIT }],
    [byPath.get("q\\.cache"), { flags: CACHE_SAFE, label: "Some cache" }],
  ]);
  const snap = buildSnapshot(tree, { junk });
  assert.equal(snap.junkBytes[0], 180);
  assert.equal(snap.junkBytes[snap.recToId[byPath.get("p")]], 150);
  assert.equal(snap.labels.get(snap.recToId[byPath.get("q\\.cache")]), "Some cache");
});

test("page: children, grandchildren, other bucket and own files", () => {
  const folders = { "": 5 };
  for (let i = 0; i < 45; i++) folders[`d${i}`] = 100 + i;
  folders["d44\\inner"] = 3;
  const { tree } = fakeTree(folders);
  const snap = buildSnapshot(tree);

  const page = childrenPage(snap, 0, { depth: 2, limit: 40 });
  assert.equal(page.node.id, 0);
  assert.equal(page.children.length, 40);
  assert.equal(page.children[0].name, "d44");
  assert.equal(page.children[0].bytes, 147);
  assert.equal(page.children[0].kids.children[0].name, "inner");
  assert.equal(page.other.count, 5);
  assert.equal(page.other.bytes, 100 + 101 + 102 + 103 + 104);
  assert.deepEqual(page.ownFiles, { bytes: 5, count: 1 });
  assert.equal(page.children[1].kids.children.length, 0);
});

test("page: depth 1 has no kids; bad ids give null", () => {
  const { tree } = sample();
  const snap = buildSnapshot(tree);
  const page = childrenPage(snap, 0, { depth: 1 });
  assert.equal(page.children[0].kids, undefined);
  assert.equal(childrenPage(snap, -1), null);
  assert.equal(childrenPage(snap, snap.count), null);
  assert.equal(childrenPage(snap, 1.5), null);
});

test("page: rows too close to the root or protected are locked", () => {
  const { tree, byPath } = sample();
  const snap = buildSnapshot(tree);
  const page = childrenPage(snap, 0, { depth: 2 });
  const users = page.children.find((c) => c.name === "Users");
  assert.equal(users.locked, "protected system path");
  const windows = page.children.find((c) => c.name === "Windows");
  assert.equal(windows.kids.children[0].locked, "inside a protected system folder");
  const tiny = page.children.find((c) => c.name === "tiny");
  assert.equal(tiny.locked, "too close to drive root");
  const app = snap.recToId[byPath.get("Users\\dustin\\code\\app")];
  const appPage = childrenPage(snap, app);
  assert.equal(appPage.children[0].name, "node_modules");
  assert.equal(appPage.children[0].locked, undefined);
});

test("path: pathOf and idOfPath agree, any case or slash", () => {
  const { tree, byPath } = sample();
  const snap = buildSnapshot(tree);
  const id = snap.recToId[byPath.get("Users\\dustin\\code\\app\\src")];
  assert.equal(pathOf(snap, id), "C:\\Users\\dustin\\code\\app\\src");
  assert.equal(pathOf(snap, 0), "C:\\");
  assert.equal(idOfPath(snap, "c:/users/DUSTIN/code/app/src/"), id);
  assert.equal(idOfPath(snap, "C:\\"), 0);
  assert.equal(idOfPath(snap, "C:\\nope"), -1);
  assert.equal(idOfPath(snap, "D:\\Users"), -1);
});

test("changes: a removed folder leaves every ancestor's totals", () => {
  const { tree, byPath } = fakeTree({
    "p\\node_modules": 100,
    "p\\src": 10,
    "p\\big": 50,
  });
  const nm = byPath.get("p\\node_modules");
  const snap = buildSnapshot(tree, { junk: new Map([[nm, { flags: NAME_HIT }]]) });
  const p = snap.recToId[byPath.get("p")];

  const removed = applyChanges(snap, { removed: [nm, nm, 123456] });
  assert.equal(removed, 1);
  assert.equal(snap.bytes[p], 60);
  assert.equal(snap.bytes[0], 60);
  assert.equal(snap.files[0], 2);
  assert.equal(snap.junkBytes[0], 0);
  assert.equal(snap.gen, 1);

  const page = childrenPage(snap, p);
  assert.deepEqual(page.children.map((c) => c.name), ["big", "src"]);
  assert.equal(idOfPath(snap, "C:\\p\\node_modules"), -1);
});

test("changes: a folder inside a removed one is not subtracted twice", () => {
  const { tree, byPath } = fakeTree({ "p\\a\\b": 10, "p\\c": 5 });
  const snap = buildSnapshot(tree);
  applyChanges(snap, { removed: [byPath.get("p\\a"), byPath.get("p\\a\\b")], gen: 9 });
  assert.equal(snap.bytes[0], 5);
  assert.equal(snap.gen, 9);
});

test("changes: removing inside a junk folder shrinks its junk bytes by all it lost", () => {
  const { tree, byPath } = fakeTree({ "p\\.cache\\a": 10, "p\\.cache\\b": 5 });
  const cache = byPath.get("p\\.cache");
  const snap = buildSnapshot(tree, { junk: new Map([[cache, { flags: CACHE_SAFE }]]) });
  applyChanges(snap, { removed: [byPath.get("p\\.cache\\a")] });
  assert.equal(snap.junkBytes[snap.recToId[cache]], 5);
  assert.equal(snap.junkBytes[0], 5);
});
