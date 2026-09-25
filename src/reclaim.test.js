/**
 * Tests for reclaim accounting and the Zap button tone.
 *
 *   node --test src/reclaim.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { reclaimOf, shareOf, zapTone } from "./reclaim.js";

const BIG = "9007199254740993"; // past Number.MAX_SAFE_INTEGER

test("reclaim splits the selection into safe and caution bytes", () => {
  const a = { path: "a", bytes: "100" };
  const b = { path: "b", bytes: "50", risk: "caution" };
  const c = { path: "c", bytes: "25" };
  const r = reclaimOf([a, b], [a, b, c]);
  assert.deepEqual(r, {
    safe: "100",
    caution: "50",
    selected: "150",
    total: "175",
    count: 2,
    anyCaution: true,
  });
});

test("reclaim sums without losing precision", () => {
  const r = reclaimOf([{ bytes: BIG }, { bytes: "1" }], [{ bytes: BIG }, { bytes: "1" }]);
  assert.equal(r.selected, "9007199254740994");
});

test("an empty caution folder still counts as a caution pick", () => {
  const r = reclaimOf([{ bytes: "0", risk: "caution" }], [{ bytes: "0", risk: "caution" }]);
  assert.equal(r.anyCaution, true);
});

test("the Zap button is red only for a permanent delete", () => {
  assert.equal(zapTone({ anyCaution: false, permanent: false }), "current");
  assert.equal(zapTone({ anyCaution: true, permanent: false }), "caution");
  assert.equal(zapTone({ anyCaution: true, permanent: true }), "danger");
  assert.equal(zapTone({ anyCaution: false, permanent: true }), "danger");
});

test("shareOf gives a fraction and survives an empty whole", () => {
  assert.equal(shareOf("25", "100"), 0.25);
  assert.equal(shareOf("0", "0"), 0);
});
