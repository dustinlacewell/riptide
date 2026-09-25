/**
 * Tests for the protected-folder rules, directly and through screenPaths.
 *
 *   node --test plugin/protect.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { protectionOf } from "./protect.js";
import { screenPaths } from "./zap.js";

test("protect: refuses anything inside a system subtree", () => {
  const { allowed, refused } = screenPaths([
    "C:\\Windows\\System32",
    "C:\\Program Files\\App\\build",
    "C:\\Program Files (x86)\\App\\node_modules",
    "C:\\$Recycle.Bin\\S-1-5-21-1",
    "C:\\System Volume Information\\junk",
    "D:\\windows\\temp",
  ]);
  assert.deepEqual(allowed, []);
  assert.equal(refused.length, 6);
  for (const r of refused) assert.equal(r.reason, "inside a protected system folder");
});

test("protect: the subtree folders themselves are refused", () => {
  for (const p of ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"]) {
    assert.notEqual(protectionOf(p), null, p);
  }
});

test("protect: a sibling whose name starts the same is allowed", () => {
  assert.equal(protectionOf("C:\\Windowsold\\cache"), null);
  assert.equal(protectionOf("C:\\Program Files Extra\\build"), null);
  const { allowed } = screenPaths(["C:\\Windowsold\\cache"]);
  assert.deepEqual(allowed, ["C:\\Windowsold\\cache"]);
});

test("protect: exact-only entries protect only themselves", () => {
  for (const p of ["C:\\", "C:\\Users", "C:\\Users\\dustin", "C:\\ProgramData"]) {
    assert.equal(protectionOf(p), "protected system path", p);
  }
  for (const p of [
    "C:\\Users\\dustin\\AppData\\Local\\npm-cache",
    "C:\\ProgramData\\Dbg",
    "C:\\Users\\Public\\x",
  ]) {
    assert.equal(protectionOf(p), null, p);
  }
});

test("protect: traversal into a subtree is refused", () => {
  const { allowed, refused } = screenPaths(["C:\\Users\\dustin\\..\\..\\Windows\\Temp"]);
  assert.deepEqual(allowed, []);
  assert.equal(refused[0].path, "C:\\Windows\\Temp");
});
