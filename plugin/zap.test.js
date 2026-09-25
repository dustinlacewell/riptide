/**
 * Tests for path screening. This is the gate that stands between a bad
 * pattern and a destroyed system, so it gets tested directly.
 *
 *   node --test plugin/zap.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { screenPaths } from "./zap.js";

test("screen: allows an ordinary project folder", () => {
  const { allowed, refused } = screenPaths(["C:\\Users\\dustin\\proj\\node_modules"]);
  assert.equal(allowed.length, 1);
  assert.equal(refused.length, 0);
});

test("screen: refuses a drive root", () => {
  for (const root of ["C:\\", "D:\\", "C:"]) {
    const { allowed, refused } = screenPaths([root]);
    assert.equal(allowed.length, 0, `${root} must not be deletable`);
    assert.equal(refused.length, 1);
  }
});

test("screen: refuses Windows and Program Files", () => {
  const { allowed, refused } = screenPaths([
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
  ]);
  assert.equal(allowed.length, 0);
  assert.equal(refused.length, 4);
});

test("screen: refuses a user profile root but allows folders inside it", () => {
  const { allowed, refused } = screenPaths([
    "C:\\Users",
    "C:\\Users\\dustin",
    "C:\\Users\\dustin\\code\\node_modules",
  ]);
  assert.deepEqual(allowed, ["C:\\Users\\dustin\\code\\node_modules"]);
  assert.equal(refused.length, 2);
});

test("screen: refuses anything one level below a drive root", () => {
  const { allowed } = screenPaths(["C:\\node_modules"]);
  assert.equal(allowed.length, 0, "too shallow to be a real project folder");
});

test("screen: refuses the Recycle Bin and System Volume Information", () => {
  const { allowed } = screenPaths([
    "C:\\$Recycle.Bin\\S-1-5-21-1",
    "C:\\System Volume Information\\junk",
  ]);
  assert.equal(allowed.length, 0);
});

test("screen: traversal cannot smuggle a protected path through", () => {
  const { allowed, refused } = screenPaths(["C:\\Users\\dustin\\..\\..\\Windows"]);
  assert.equal(allowed.length, 0, "resolves to C:\\Windows and is refused");
  assert.equal(refused[0].path, "C:\\Windows");
});

test("screen: partitions a mixed batch instead of failing the whole thing", () => {
  const { allowed, refused } = screenPaths([
    "C:\\Users\\dustin\\a\\node_modules",
    "C:\\Windows",
    "C:\\Users\\dustin\\b\\node_modules",
  ]);
  assert.equal(allowed.length, 2);
  assert.equal(refused.length, 1);
});
