/**
 * Tests for the squarified treemap layout.
 *
 *   node --test src/squarify.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { aspect, squarify } from "./squarify.js";

const RECT = { x: 0, y: 0, w: 600, h: 400 };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const items = (values) => values.map((value, i) => ({ value, i }));

function inside(r, rect) {
  const eps = 1e-6;
  return (
    r.x >= rect.x - eps &&
    r.y >= rect.y - eps &&
    r.x + r.w <= rect.x + rect.w + eps &&
    r.y + r.h <= rect.y + rect.h + eps
  );
}

test("squarify: areas are proportional to values and fill the rect", () => {
  const values = [60, 60, 40, 30, 20, 20, 10];
  const out = squarify(items(values), RECT);
  const total = values.reduce((a, b) => a + b, 0);
  assert.equal(out.length, values.length);
  let area = 0;
  for (const r of out) {
    assert.ok(close(r.w * r.h, (r.item.value / total) * RECT.w * RECT.h, 1e-9));
    assert.ok(inside(r, RECT));
    area += r.w * r.h;
  }
  assert.ok(close(area, RECT.w * RECT.h));
});

test("squarify: the classic example stays near square", () => {
  const out = squarify(items([6, 6, 4, 3, 2, 2, 1]), { x: 0, y: 0, w: 6, h: 4 });
  for (const r of out) assert.ok(aspect(r) <= 3, `aspect ${aspect(r)}`);
});

test("squarify: a folder-like spread keeps the worst aspect near 3", () => {
  // A long tail, the way folder sizes run: each a bit over half the last.
  const values = Array.from({ length: 30 }, (_, i) => Math.round(1e9 * 0.6 ** i) + 1);
  const out = squarify(items(values), RECT);
  const big = out.filter((r) => r.w * r.h > 400);
  for (const r of big) assert.ok(aspect(r) <= 3.2, `aspect ${aspect(r)} for ${r.item.value}`);
});

test("squarify: equal values tile evenly", () => {
  const out = squarify(items(Array(16).fill(5)), { x: 0, y: 0, w: 400, h: 400 });
  for (const r of out) assert.ok(aspect(r) <= 1.5);
});

test("squarify: zeros and negatives get no rect", () => {
  const out = squarify(items([0, 10, -3, 5, 0]), RECT);
  assert.deepEqual(out.map((r) => r.item.value), [10, 5]);
  assert.deepEqual(squarify(items([0, 0]), RECT), []);
  assert.deepEqual(squarify([], RECT), []);
});

test("squarify: largest first, whatever the input order", () => {
  const out = squarify(items([1, 9, 4]), RECT);
  assert.deepEqual(out.map((r) => r.item.value), [9, 4, 1]);
});

test("squarify: a tiny or empty rect is handled", () => {
  assert.deepEqual(squarify(items([1, 2]), { x: 0, y: 0, w: 0, h: 10 }), []);
  const out = squarify(items([3, 2, 1]), { x: 5, y: 5, w: 1, h: 1 });
  assert.equal(out.length, 3);
  for (const r of out) {
    assert.ok(Number.isFinite(r.w) && Number.isFinite(r.h));
    assert.ok(inside(r, { x: 5, y: 5, w: 1, h: 1 }));
  }
});

test("squarify: a huge value next to specks keeps every rect finite and inside", () => {
  const out = squarify(items([1e12, 1, 1, 1]), RECT);
  assert.equal(out.length, 4);
  for (const r of out) {
    assert.ok(r.w >= 0 && r.h >= 0);
    assert.ok(inside(r, RECT));
  }
});
