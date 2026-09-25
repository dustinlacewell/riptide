/**
 * Tests for the /plan gate: provenance, then the protected-path screen.
 *
 *   node --test plugin/plan.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildPlan } from "./plan.js";
import { createOffered } from "./offered.js";
import { screenPaths } from "./zap.js";

function setup(paths) {
  const offered = createOffered();
  offered.add(paths, "zap");
  return { offered, screen: screenPaths };
}

test("plan: a path no scan offered is refused", () => {
  const deps = setup([]);
  const { allowed, refused } = buildPlan(["C:\\Users\\dustin\\a\\node_modules"], deps);
  assert.deepEqual(allowed, []);
  assert.deepEqual(refused, [
    { path: "C:\\Users\\dustin\\a\\node_modules", reason: "not found by a scan" },
  ]);
});

test("plan: an offered but protected path is refused", () => {
  const deps = setup(["C:\\Windows\\System32", "C:\\Program Files\\App\\build"]);
  const { allowed, refused } = buildPlan(
    ["C:\\Windows\\System32", "C:\\Program Files\\App\\build"],
    deps,
  );
  assert.deepEqual(allowed, []);
  assert.equal(refused.length, 2);
  for (const r of refused) assert.equal(r.reason, "inside a protected system folder");
});

test("plan: an offered path is accepted, under any spelling", () => {
  const deps = setup(["C:\\Users\\dustin\\a\\node_modules"]);
  const { allowed, refused } = buildPlan(["c:/users/dustin/a/node_modules/"], deps);
  assert.equal(allowed.length, 1);
  assert.deepEqual(refused, []);
});

test("plan: junk entries are refused, not thrown", () => {
  const deps = setup([]);
  const { allowed, refused } = buildPlan([null, 42, ""], deps);
  assert.deepEqual(allowed, []);
  assert.equal(refused.length, 3);
});

test("plan: a mixed batch partitions", () => {
  const deps = setup(["C:\\Users\\dustin\\a\\node_modules", "C:\\Windows\\Temp"]);
  const { allowed, refused } = buildPlan(
    ["C:\\Users\\dustin\\a\\node_modules", "C:\\Windows\\Temp", "C:\\Users\\dustin\\b\\x"],
    deps,
  );
  assert.equal(allowed.length, 1);
  assert.deepEqual(
    refused.map((r) => r.reason).sort(),
    ["inside a protected system folder", "not found by a scan"],
  );
});
