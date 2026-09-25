/**
 * Tests for display formatting.
 *
 *   node --test src/format.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { clockTime, compactCount, perSecond } from "./format.js";

test("clockTime writes mm:ss.t", () => {
  assert.equal(clockTime(0), "00:00.0");
  assert.equal(clockTime(16_700), "00:16.7");
  assert.equal(clockTime(26_149), "00:26.1");
  assert.equal(clockTime(125_300), "02:05.3");
});

test("perSecond shortens by thousands", () => {
  assert.equal(perSecond(840), "840/s");
  assert.equal(perSecond(9_800), "9.8k/s");
  assert.equal(perSecond(187_234), "187k/s");
  assert.equal(perSecond(1_240_000), "1.2M/s");
});

test("compactCount shortens by thousands", () => {
  assert.equal(compactCount(812), "812");
  assert.equal(compactCount(41_234), "41.2k");
  assert.equal(compactCount(4_870_112), "4.87M");
});
