/**
 * Tests for grouping the Caches table by cache rule.
 *
 *   node --test src/group.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { groupHits, sortGroups } from "./group.js";

const hit = (id, path, bytes, files, extra = {}) => ({
  id,
  label: `${id} cache`,
  tool: id,
  pack: "test",
  cost: "rebuilt on next run",
  path,
  bytes: String(bytes),
  files,
  ...extra,
});

const ids = (groups) => groups.map((g) => g.id);
const paths = (rows) => rows.map((r) => r.path);

test("groups hits by rule id", () => {
  const rows = [
    hit("pycache", "a", 10, 1),
    hit("vite", "b", 20, 2),
    hit("pycache", "c", 30, 3),
  ];
  const groups = groupHits(rows);

  assert.equal(groups.length, 2);
  assert.deepEqual(ids(groups), ["pycache", "vite"], "first-seen order");
  assert.equal(groups[0].count, 2);
  assert.equal(groups[1].count, 1);
});

test("groups by id, not by label", () => {
  // Two packs can name a cache the same thing. Merging them would report a
  // rule that does not exist.
  const rows = [
    { ...hit("npm", "a", 10, 1), label: "Package cache" },
    { ...hit("pnpm", "b", 20, 2), label: "Package cache" },
  ];
  const groups = groupHits(rows);

  assert.equal(groups.length, 2);
  assert.deepEqual(ids(groups), ["npm", "pnpm"]);
});

test("sums sizes as BigInt across a group that overflows Number", () => {
  // Three members that each fit in a float but whose sum does not. Adding
  // through Number loses the low digits and under-reports the group.
  const each = "9007199254740993";
  const rows = [
    hit("pycache", "a", each, 1),
    hit("pycache", "b", each, 1),
    hit("pycache", "c", each, 1),
  ];
  const [group] = groupHits(rows);

  assert.equal(group.bytes, (BigInt(each) * 3n).toString());
  assert.equal(typeof group.bytes, "string", "stays a BigInt string");
  assert.notEqual(
    group.bytes,
    String(Number(each) * 3),
    "a Number sum would have been wrong",
  );
});

test("sums file counts across a group", () => {
  const rows = [hit("pycache", "a", 1, 40), hit("pycache", "b", 1, 2)];
  assert.equal(groupHits(rows)[0].files, 42);
});

test("a single-member group carries that one member", () => {
  const rows = [hit("gradle", "G:\\gradle", 500, 7)];
  const [group] = groupHits(rows);

  assert.equal(group.count, 1);
  assert.equal(group.bytes, "500");
  assert.equal(group.files, 7);
  assert.deepEqual(paths(group.paths), ["G:\\gradle"]);
});

test("members sort biggest first, whatever the group sort", () => {
  // Not user-controlled: the largest instance of a rule is the one worth
  // seeing at the top of the expansion.
  const rows = [
    hit("pycache", "small", 10, 1),
    hit("pycache", "huge", 900, 1),
    hit("pycache", "mid", 100, 1),
  ];
  assert.deepEqual(paths(groupHits(rows)[0].paths), ["huge", "mid", "small"]);
});

test("members compare as BigInt, not Number", () => {
  const big = "9007199254740992";
  const bigger = "9007199254740993";
  const rows = [hit("pycache", "small", big, 1), hit("pycache", "large", bigger, 1)];

  assert.equal(Number(big), Number(bigger), "these are identical as floats");
  assert.deepEqual(paths(groupHits(rows)[0].paths), ["large", "small"]);
});

test("carries the rule's label, cost and risk onto the group", () => {
  const risky = { risk: "caution", riskNote: "stops running containers", cost: "slow" };
  const rows = [hit("docker", "a", 1, 1, risky), hit("docker", "b", 1, 1, risky)];
  const [group] = groupHits(rows);

  assert.equal(group.label, "docker cache");
  assert.equal(group.cost, "slow");
  assert.equal(group.risk, "caution");
  assert.equal(group.riskNote, "stops running containers");
});

test("sorts groups by summed size", () => {
  const groups = groupHits([
    hit("a", "a1", 10, 1),
    hit("b", "b1", 6, 1),
    hit("b", "b2", 6, 1),
    hit("c", "c1", 1, 1),
  ]);

  assert.deepEqual(
    ids(sortGroups(groups, { key: "bytes", direction: "desc" })),
    ["b", "a", "c"],
    "b wins on its sum, not on any one member",
  );
});

test("sorts groups by summed size as BigInt", () => {
  const groups = groupHits([
    hit("small", "s", "9007199254740992", 1),
    hit("large", "l", "9007199254740993", 1),
  ]);
  assert.deepEqual(
    ids(sortGroups(groups, { key: "bytes", direction: "desc" })),
    ["large", "small"],
  );
});

test("sorts groups by instance count", () => {
  const groups = groupHits([
    hit("one", "a", 1, 1),
    hit("three", "b", 1, 1),
    hit("three", "c", 1, 1),
    hit("three", "d", 1, 1),
    hit("two", "e", 1, 1),
    hit("two", "f", 1, 1),
  ]);

  assert.deepEqual(
    ids(sortGroups(groups, { key: "count", direction: "desc" })),
    ["three", "two", "one"],
  );
  assert.deepEqual(
    ids(sortGroups(groups, { key: "count", direction: "asc" })),
    ["one", "two", "three"],
  );
});

test("sorts groups by summed file count", () => {
  const groups = groupHits([
    hit("a", "a1", 1, 5),
    hit("b", "b1", 1, 1),
    hit("b", "b2", 1, 1),
    hit("c", "c1", 1, 50),
  ]);
  assert.deepEqual(
    ids(sortGroups(groups, { key: "files", direction: "asc" })),
    ["b", "a", "c"],
  );
});

test("sorts groups by label, biggest first on a tie", () => {
  const groups = groupHits([
    { ...hit("z", "z1", 1, 1), label: "Astro" },
    { ...hit("a", "a1", 900, 1), label: "Vite" },
    { ...hit("m", "m1", 100, 1), label: "Astro" },
  ]);
  assert.deepEqual(
    ids(sortGroups(groups, { key: "label", direction: "asc" })),
    ["m", "z", "a"],
  );
});

test("an unknown sort key falls back to size", () => {
  const groups = groupHits([hit("a", "a1", 1, 1), hit("b", "b1", 9, 1)]);
  assert.deepEqual(
    ids(sortGroups(groups, { key: "mtime", direction: "desc" })),
    ["b", "a"],
  );
});

test("does not mutate the input array", () => {
  const rows = [hit("a", "a1", 10, 1), hit("b", "b1", 30, 1)];
  const before = paths(rows);

  const groups = groupHits(rows);
  sortGroups(groups, { key: "bytes", direction: "asc" });

  assert.deepEqual(paths(rows), before);
  assert.deepEqual(ids(groups), ["a", "b"], "sortGroups returns a new array");
});
