/**
 * Tests for the record-number bitset.
 *
 *   node --test plugin/mft/bitset.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createBitset } from "./bitset.js";

test("bitset: set bits are held, others are not", () => {
  const bits = createBitset(100);
  bits.set(7);
  assert.equal(bits.has(7), true);
  assert.equal(bits.has(6), false);
  assert.equal(bits.has(8), false);
});

test("bitset: word boundaries 0, 31, 32 and the last bit", () => {
  const bits = createBitset(64);
  for (const i of [0, 31, 32, 63]) bits.set(i);
  for (const i of [0, 31, 32, 63]) assert.equal(bits.has(i), true, `bit ${i}`);
  for (const i of [1, 30, 33, 62]) assert.equal(bits.has(i), false, `bit ${i}`);
});

test("bitset: a bit past the end reads as unset", () => {
  const bits = createBitset(32);
  assert.equal(bits.has(32), false);
  assert.equal(bits.has(1_000_000), false);
});

test("bitset: a bit past the end grows the set and keeps the old bits", () => {
  const bits = createBitset(32);
  bits.set(5);
  bits.set(31);
  bits.set(10_000);
  assert.equal(bits.has(5), true);
  assert.equal(bits.has(31), true);
  assert.equal(bits.has(10_000), true);
  assert.equal(bits.has(9_999), false);
});

test("bitset: an empty set grows from nothing", () => {
  const bits = createBitset();
  assert.equal(bits.has(0), false);
  bits.set(0);
  assert.equal(bits.has(0), true);
});

test("bitset: memory is one bit per record", () => {
  assert.equal(createBitset(4_870_000).bytes, Math.ceil(4_870_000 / 32) * 4);
});
