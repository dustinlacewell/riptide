/**
 * Tests for tween math.
 *
 *   node --test src/ui/tween.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { tweenValue } from "./tween.js";

test("a tween starts at from and lands exactly on to", () => {
  assert.equal(tweenValue(0, 100, 0, 600), 0);
  assert.equal(tweenValue(0, 100, 600, 600), 100);
  assert.equal(tweenValue(0, 100, 900, 600), 100);
});

test("a tween eases out: past halfway at the midpoint", () => {
  assert.ok(tweenValue(0, 100, 300, 600) > 50);
});

test("a tween counts down as well as up", () => {
  assert.equal(tweenValue(100, 40, 600, 600), 40);
  assert.ok(tweenValue(100, 40, 300, 600) < 70);
});

test("a zero duration jumps to the end", () => {
  assert.equal(tweenValue(0, 100, 0, 0), 100);
});
