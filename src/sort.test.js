/**
 * Tests for results-table sorting.
 *
 *   node --test src/sort.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { sortHits, nextSort, DEFAULT_SORT } from "./sort.js";

const hit = (path, bytes, files, mtime = null) => ({
  path,
  bytes: String(bytes),
  files,
  mtime,
});

const paths = (rows) => rows.map((r) => r.path);

test("sorts by size descending by default", () => {
  const rows = [hit("a", 100, 1), hit("b", 300, 1), hit("c", 200, 1)];
  assert.deepEqual(paths(sortHits(rows, DEFAULT_SORT)), ["b", "c", "a"]);
});

test("compares sizes as BigInt, not Number", () => {
  // Both exceed Number.MAX_SAFE_INTEGER and differ only in the low digits.
  // Coercing through Number collapses them to the same float and the sort
  // silently reports the wrong order.
  const big = "9007199254740992";
  const bigger = "9007199254740993";
  const rows = [hit("small", big, 1), hit("large", bigger, 1)];

  assert.notEqual(BigInt(big), BigInt(bigger));
  assert.equal(Number(big), Number(bigger), "these are identical as floats");

  assert.deepEqual(
    paths(sortHits(rows, { key: "bytes", direction: "desc" })),
    ["large", "small"],
  );
});

test("sorts paths naturally, so pkg10 follows pkg9", () => {
  const rows = [hit("pkg10", 1, 1), hit("pkg9", 1, 1), hit("pkg1", 1, 1)];
  assert.deepEqual(
    paths(sortHits(rows, { key: "path", direction: "asc" })),
    ["pkg1", "pkg9", "pkg10"],
  );
});

test("sorts by file count", () => {
  const rows = [hit("a", 1, 50), hit("b", 1, 5), hit("c", 1, 500)];
  assert.deepEqual(
    paths(sortHits(rows, { key: "files", direction: "asc" })),
    ["b", "a", "c"],
  );
});

test("sorts by modified date, newest first", () => {
  const rows = [
    hit("old", 1, 1, "2020-01-01T00:00:00Z"),
    hit("new", 1, 1, "2026-01-01T00:00:00Z"),
    hit("mid", 1, 1, "2023-01-01T00:00:00Z"),
  ];
  assert.deepEqual(
    paths(sortHits(rows, { key: "mtime", direction: "desc" })),
    ["new", "mid", "old"],
  );
});

test("rows with no timestamp sort oldest", () => {
  const rows = [hit("dated", 1, 1, "2020-01-01T00:00:00Z"), hit("undated", 1, 1, null)];
  assert.deepEqual(
    paths(sortHits(rows, { key: "mtime", direction: "desc" })),
    ["dated", "undated"],
  );
});

test("sorts caches by label, biggest instance first within a label", () => {
  // The same cache name appears once per project, so a plain alphabetical
  // sort would scatter the large ones among hundreds of tiny ones.
  const rows = [
    { ...hit("a", 100, 1), label: "Vite deps cache" },
    { ...hit("b", 900, 1), label: "Vite deps cache" },
    { ...hit("c", 500, 1), label: "Astro build cache" },
  ];
  assert.deepEqual(
    paths(sortHits(rows, { key: "label", direction: "asc" })),
    ["c", "b", "a"],
  );
});

test("does not mutate the input array", () => {
  const rows = [hit("a", 100, 1), hit("b", 300, 1)];
  const before = paths(rows);
  sortHits(rows, { key: "bytes", direction: "desc" });
  assert.deepEqual(paths(rows), before);
});

test("clicking a new column uses its natural direction", () => {
  // Size and counts read largest-first; a path reads A-Z.
  assert.deepEqual(nextSort({ key: "path", direction: "asc" }, "bytes"), {
    key: "bytes",
    direction: "desc",
  });
  assert.deepEqual(nextSort({ key: "bytes", direction: "desc" }, "path"), {
    key: "path",
    direction: "asc",
  });
});

test("clicking the active column flips its direction", () => {
  const first = nextSort(DEFAULT_SORT, "bytes");
  assert.equal(first.direction, "asc", "flips away from the default desc");
  assert.equal(nextSort(first, "bytes").direction, "desc", "and back again");
});
