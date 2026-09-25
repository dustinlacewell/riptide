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

/** A plan of paths only, as the path items it allows. */
function pathPlan(paths, deps) {
  const { items, refused } = buildPlan({ paths }, deps);
  return { allowed: items.map((i) => i.path), refused };
}

test("plan: a path no scan offered is refused", () => {
  const deps = setup([]);
  const { allowed, refused } = pathPlan(["C:\\Users\\dustin\\a\\node_modules"], deps);
  assert.deepEqual(allowed, []);
  assert.deepEqual(refused, [
    { path: "C:\\Users\\dustin\\a\\node_modules", reason: "not found by a scan" },
  ]);
});

test("plan: an offered but protected path is refused", () => {
  const deps = setup(["C:\\Windows\\System32", "C:\\Program Files\\App\\build"]);
  const { allowed, refused } = pathPlan(
    ["C:\\Windows\\System32", "C:\\Program Files\\App\\build"],
    deps,
  );
  assert.deepEqual(allowed, []);
  assert.equal(refused.length, 2);
  for (const r of refused) assert.equal(r.reason, "inside a protected system folder");
});

test("plan: an offered path is accepted, under any spelling", () => {
  const deps = setup(["C:\\Users\\dustin\\a\\node_modules"]);
  const { allowed, refused } = pathPlan(["c:/users/dustin/a/node_modules/"], deps);
  assert.equal(allowed.length, 1);
  assert.deepEqual(refused, []);
});

test("plan: junk entries are refused, not thrown", () => {
  const deps = setup([]);
  const { allowed, refused } = pathPlan([null, 42, ""], deps);
  assert.deepEqual(allowed, []);
  assert.equal(refused.length, 3);
});

test("plan: a cache at a drive root passes; the same path from zap does not", () => {
  const offered = createOffered();
  offered.add(["D:\\.pnpm-store"], "caches");
  offered.add(["D:\\node_modules"], "zap");
  offered.add(["D:\\stuff"], "map");
  const { allowed, refused } = pathPlan(
    ["D:\\.pnpm-store", "D:\\node_modules", "D:\\stuff"],
    { offered, screen: screenPaths },
  );
  assert.deepEqual(allowed, ["D:\\.pnpm-store"]);
  assert.deepEqual(
    refused.map((r) => r.reason),
    ["too close to drive root", "too close to drive root"],
  );
});

test("plan: a cache offer still cannot reach a protected path", () => {
  const offered = createOffered();
  offered.add(["C:\\Windows\\Temp", "C:\\", "C:\\Users\\dustin"], "caches");
  const { allowed, refused } = pathPlan(
    ["C:\\Windows\\Temp", "C:\\", "C:\\Users\\dustin"],
    { offered, screen: screenPaths },
  );
  assert.deepEqual(allowed, []);
  assert.equal(refused.length, 3);
});

test("plan: a path offered by both zap and caches gets the cache waiver", () => {
  const offered = createOffered();
  offered.add(["D:\\.cache"], "zap");
  offered.add(["D:\\.cache"], "caches");
  const { allowed } = pathPlan(["D:\\.cache"], { offered, screen: screenPaths });
  assert.deepEqual(allowed, ["D:\\.cache"]);
});

test("plan: a mixed batch partitions", () => {
  const deps = setup(["C:\\Users\\dustin\\a\\node_modules", "C:\\Windows\\Temp"]);
  const { allowed, refused } = pathPlan(
    ["C:\\Users\\dustin\\a\\node_modules", "C:\\Windows\\Temp", "C:\\Users\\dustin\\b\\x"],
    deps,
  );
  assert.equal(allowed.length, 1);
  assert.deepEqual(
    refused.map((r) => r.reason).sort(),
    ["inside a protected system folder", "not found by a scan"],
  );
});

// --- actions ---------------------------------------------------------------

test("plan: an action the cache scan offered becomes an item after the paths", () => {
  const offered = createOffered();
  offered.add(["C:\\Users\\dustin\\a\\node_modules"], "zap");
  offered.addActions(["pnpm-store-prune"], "caches");
  const plan = buildPlan(
    { paths: ["C:\\Users\\dustin\\a\\node_modules"], actions: ["pnpm-store-prune"] },
    { offered, screen: screenPaths },
  );
  assert.deepEqual(plan.items, [
    { kind: "path", path: "C:\\Users\\dustin\\a\\node_modules" },
    { kind: "action", id: "pnpm-store-prune" },
  ]);
  assert.deepEqual(plan.refusedActions, []);
});

test("plan: an action no scan offered is refused; junk too; repeats collapse", () => {
  const offered = createOffered();
  offered.addActions(["docker-image-prune"], "caches");
  const plan = buildPlan(
    { actions: ["docker-image-prune", "docker-image-prune", "wsl-compact", null, 7] },
    { offered, screen: screenPaths },
  );
  assert.deepEqual(plan.items, [{ kind: "action", id: "docker-image-prune" }]);
  assert.deepEqual(
    plan.refusedActions.map((r) => r.id),
    ["wsl-compact", "null", "7"],
  );
});

test("plan: a new cache scan withdraws its action offers; offers expire", () => {
  let t = 0;
  const offered = createOffered({ now: () => t, ttlMs: 100 });
  offered.addActions(["wsl-compact"], "caches");
  offered.add(["C:\\a\\b\\c"], "zap");
  offered.clear("caches");
  assert.deepEqual(offered.actionSourcesOf("wsl-compact"), []);
  assert.equal(offered.has("C:\\a\\b\\c"), true, "clearing caches leaves zap's paths");

  offered.addActions(["wsl-compact"], "caches");
  t = 100;
  const plan = buildPlan({ actions: ["wsl-compact"] }, { offered, screen: screenPaths });
  assert.deepEqual(plan.items, []);
});

test("plan: an action id is not a path, and a path is not an action", () => {
  const offered = createOffered();
  offered.add(["C:\\x\\y\\wsl-compact"], "zap");
  offered.addActions(["C:\\x\\y\\z"], "caches");
  const plan = buildPlan(
    { paths: ["C:\\x\\y\\z"], actions: ["wsl-compact"] },
    { offered, screen: screenPaths },
  );
  assert.deepEqual(plan.items, []);
});
