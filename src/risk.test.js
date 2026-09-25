/**
 * Tests for row risk.
 *
 *   node --test src/risk.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { riskOf, refusedPaths } from "./risk.js";
import { pathKey } from "./pathKey.js";

test("a hit with no risk field is safe", () => {
  assert.equal(riskOf({ path: "D:\\code\\a\\node_modules" }), "safe");
});

test("an engine risk of safe stays safe", () => {
  assert.equal(riskOf({ path: "C:\\x", risk: "safe" }), "safe");
});

test("an engine caution is caution", () => {
  assert.equal(riskOf({ path: "D:\\code\\bin", risk: "caution" }), "caution");
});

test("a refused path is refused, even when the engine says caution", () => {
  const refused = refusedPaths([{ path: "C:\\Windows\\Temp", reason: "protected" }]);
  assert.equal(riskOf({ path: "C:\\Windows\\Temp", risk: "caution" }, refused), "refused");
});

test("refused paths match without case", () => {
  const refused = refusedPaths([{ path: "C:\\WINDOWS\\Temp" }]);
  assert.equal(riskOf({ path: "c:\\windows\\temp" }, refused), "refused");
});

test("refused paths match across trailing slash and case", () => {
  const refused = refusedPaths([{ path: "C:\\Windows" }]);
  assert.equal(riskOf({ path: "c:\\windows\\" }, refused), "refused");
});

test("refused paths match across forward slashes", () => {
  const refused = refusedPaths([{ path: "C:\\Windows" }]);
  assert.equal(riskOf({ path: "C:/Windows" }, refused), "refused");
});

test("refused paths match with a trailing slash on a spaced name", () => {
  const refused = refusedPaths([{ path: "C:\\Program Files" }]);
  assert.equal(riskOf({ path: "C:\\Program Files\\" }, refused), "refused");
});

test("pathKey writes a path the way path.resolve would, lower-cased", () => {
  assert.equal(pathKey("c:\\windows\\"), "c:\\windows");
  assert.equal(pathKey("C:/Windows"), "c:\\windows");
  assert.equal(pathKey("C:\\Program Files\\"), "c:\\program files");
  assert.equal(pathKey("C:\\a\\\\b\\.\\c\\.."), "c:\\a\\b");
  assert.equal(pathKey("C:"), "c:\\");
  assert.equal(pathKey("C:\\"), "c:\\");
});

test("a path not in the refused set keeps its own risk", () => {
  const refused = refusedPaths([{ path: "C:\\Windows" }]);
  assert.equal(riskOf({ path: "C:\\Windows\\Temp" }, refused), "safe");
});

test("an item without a path is judged on its risk alone", () => {
  assert.equal(riskOf({ risk: "caution" }, refusedPaths([{ path: "x" }])), "caution");
});

test("refusedPaths takes a missing list as empty", () => {
  assert.equal(refusedPaths(undefined).size, 0);
});
