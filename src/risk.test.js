/**
 * Tests for row risk.
 *
 *   node --test src/risk.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { riskOf, refusedPaths } from "./risk.js";

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
