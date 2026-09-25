/**
 * Tests for the offered-path store and its path key.
 *
 *   node --test plugin/offered.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createOffered } from "./offered.js";
import { pathKey } from "./pathKey.js";

test("pathKey: trailing separator, slashes and case give one key", () => {
  assert.equal(pathKey("c:\\foo\\"), pathKey("C:/foo"));
  assert.equal(pathKey("C:/foo"), pathKey("C:\\FOO"));
  assert.equal(pathKey("C:\\FOO"), "c:\\foo");
});

test("pathKey: a drive root keeps its separator", () => {
  assert.equal(pathKey("C:\\"), "c:\\");
  assert.equal(pathKey("C:\\\\"), "c:\\");
});

test("offered: has only what was added, under any spelling", () => {
  const offered = createOffered();
  offered.add(["C:\\Users\\dustin\\a\\node_modules"], "zap");
  assert.equal(offered.has("c:/users/dustin/a/node_modules/"), true);
  assert.equal(offered.has("C:\\Users\\dustin\\b\\node_modules"), false);
  assert.equal(offered.has("C:\\Users\\dustin\\a"), false, "a parent is not offered");
});

test("offered: clear drops one source and keeps the other", () => {
  const offered = createOffered();
  offered.add(["C:\\x\\a"], "zap");
  offered.add(["C:\\x\\b"], "caches");
  offered.add(["C:\\x\\both"], "zap");
  offered.add(["C:\\x\\both"], "caches");

  offered.clear("zap");

  assert.equal(offered.has("C:\\x\\a"), false);
  assert.equal(offered.has("C:\\x\\b"), true);
  assert.equal(offered.has("C:\\x\\both"), true, "still offered by caches");
});

test("offered: sourcesOf lists the live sources of a path", () => {
  let t = 0;
  const offered = createOffered({ now: () => t, ttlMs: 100 });
  offered.add(["C:\\x\\a"], "zap");
  t = 50;
  offered.add(["C:\\x\\a"], "caches");
  assert.deepEqual(offered.sourcesOf("c:/x/a").sort(), ["caches", "zap"]);
  t = 120;
  assert.deepEqual(offered.sourcesOf("C:\\x\\a"), ["caches"]);
  assert.deepEqual(offered.sourcesOf("C:\\x\\none"), []);
});

test("offered: entries expire after the ttl", () => {
  let t = 1000;
  const offered = createOffered({ now: () => t, ttlMs: 60 * 60 * 1000 });
  offered.add(["C:\\x\\a"], "zap");

  t += 60 * 60 * 1000 - 1;
  assert.equal(offered.has("C:\\x\\a"), true);

  t += 1;
  assert.equal(offered.has("C:\\x\\a"), false);
});

test("offered: re-adding refreshes the expiry", () => {
  let t = 0;
  const offered = createOffered({ now: () => t, ttlMs: 100 });
  offered.add(["C:\\x\\a"], "zap");
  t = 90;
  offered.add(["C:\\x\\a"], "zap");
  t = 150;
  assert.equal(offered.has("C:\\x\\a"), true);
});
