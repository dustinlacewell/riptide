/**
 * Tests for breadcrumb splitting.
 *
 *   node --test src/crumbs.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { crumbs } from "./crumbs.js";

test("splits a path into ancestors, outermost first", () => {
  assert.deepEqual(crumbs("D:\\code\\tools\\riptide"), [
    { label: "D:", path: "D:\\" },
    { label: "code", path: "D:\\code" },
    { label: "tools", path: "D:\\code\\tools" },
    { label: "riptide", path: "D:\\code\\tools\\riptide" },
  ]);
});

test("the drive crumb keeps its trailing separator", () => {
  // "C:" alone names the current directory on that drive, not its root.
  assert.deepEqual(crumbs("C:\\"), [{ label: "C:", path: "C:\\" }]);
});

test("collapses repeated separators", () => {
  assert.deepEqual(
    crumbs("D:\\\\code\\\\tools").map((c) => c.path),
    ["D:\\", "D:\\code", "D:\\code\\tools"],
  );
});

test("accepts forward slashes", () => {
  assert.deepEqual(
    crumbs("D:/code/tools").map((c) => c.path),
    ["D:\\", "D:\\code", "D:\\code\\tools"],
  );
});

test("a trailing separator adds no empty crumb", () => {
  assert.deepEqual(
    crumbs("D:\\code\\").map((c) => c.label),
    ["D:", "code"],
  );
});

test("returns nothing for an absent path", () => {
  for (const value of [null, undefined, "", "   ", 42]) {
    assert.deepEqual(crumbs(value), [], `${String(value)} has no ancestors`);
  }
});
