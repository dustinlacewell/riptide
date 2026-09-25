/**
 * Tests for preference persistence.
 *
 *   node --test src/persist.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { load, remember, save, RECENT_LIMIT } from "./persist.js";

const DEFAULTS = {
  root: "",
  patterns: "node_modules",
  sort: { key: "bytes", direction: "desc" },
};
const KEYS = ["path", "bytes", "files", "mtime"];

/** Minimal localStorage stand-in; `throws` simulates a blocked store. */
function stubStorage({ initial = null, throws = false } = {}) {
  let value = initial;
  globalThis.window = {
    localStorage: {
      getItem() {
        if (throws) throw new Error("access denied");
        return value;
      },
      setItem(_key, v) {
        if (throws) throw new Error("access denied");
        value = v;
      },
    },
  };
  return () => value;
}

test("returns defaults when nothing is stored", () => {
  stubStorage();
  assert.deepEqual(load(DEFAULTS, KEYS), DEFAULTS);
});

test("round-trips root, patterns and sort", () => {
  const read = stubStorage();
  save({ root: "D:\\code", patterns: "dist, target", sort: { key: "files", direction: "asc" } });

  stubStorage({ initial: read() });
  assert.deepEqual(load(DEFAULTS, KEYS), {
    root: "D:\\code",
    patterns: "dist, target",
    sort: { key: "files", direction: "asc" },
  });
});

test("falls back to defaults on malformed JSON", () => {
  stubStorage({ initial: "{not json" });
  assert.deepEqual(load(DEFAULTS, KEYS), DEFAULTS);
});

test("ignores a sort key this build no longer has", () => {
  // An older build may have stored a column since removed. Sorting by a
  // key with no comparator would leave the table in arbitrary order.
  stubStorage({
    initial: JSON.stringify({ root: "D:\\code", sort: { key: "owner", direction: "asc" } }),
  });
  const prefs = load(DEFAULTS, KEYS);
  assert.deepEqual(prefs.sort, DEFAULTS.sort);
  assert.equal(prefs.root, "D:\\code", "the rest of the stored prefs still apply");
});

test("ignores a bad sort direction", () => {
  stubStorage({
    initial: JSON.stringify({ sort: { key: "files", direction: "sideways" } }),
  });
  assert.deepEqual(load(DEFAULTS, KEYS).sort, DEFAULTS.sort);
});

test("ignores fields of the wrong type", () => {
  stubStorage({ initial: JSON.stringify({ root: 42, patterns: ["dist"] }) });
  const prefs = load(DEFAULTS, KEYS);
  assert.equal(prefs.root, DEFAULTS.root);
  assert.equal(prefs.patterns, DEFAULTS.patterns);
});

test("survives storage that throws on read", () => {
  // Private windows and blocked site data throw rather than return null.
  stubStorage({ throws: true });
  assert.deepEqual(load(DEFAULTS, KEYS), DEFAULTS);
});

test("survives storage that throws on write", () => {
  stubStorage({ throws: true });
  assert.doesNotThrow(() => save({ root: "D:\\", patterns: "x", sort: DEFAULTS.sort }));
});

test("remembers the search tab's own settings", () => {
  const withSearch = {
    ...DEFAULTS,
    tab: "zap",
    pattern: "",
    globs: "",
    caseMode: "smart",
    regex: true,
  };
  stubStorage({
    initial: JSON.stringify({
      tab: "search",
      pattern: "TODO",
      globs: "*.js",
      caseMode: "sensitive",
      regex: false,
    }),
  });

  const prefs = load(withSearch, KEYS);
  assert.equal(prefs.tab, "search");
  assert.equal(prefs.pattern, "TODO");
  assert.equal(prefs.globs, "*.js");
  assert.equal(prefs.caseMode, "sensitive");
  assert.equal(prefs.regex, false);
});

test("ignores an unknown tab or case mode", () => {
  const withSearch = { ...DEFAULTS, tab: "zap", caseMode: "smart" };
  stubStorage({ initial: JSON.stringify({ tab: "elsewhere", caseMode: "sideways" }) });

  const prefs = load(withSearch, KEYS);
  assert.equal(prefs.tab, "zap");
  assert.equal(prefs.caseMode, "smart");
});

// --- recent roots ---------------------------------------------------------

test("remember: puts the newest root first", () => {
  assert.deepEqual(remember(["D:\\code"], "D:\\tmp"), ["D:\\tmp", "D:\\code"]);
});

test("remember: re-picking a root moves it up rather than duplicating it", () => {
  assert.deepEqual(remember(["D:\\a", "D:\\b", "D:\\c"], "D:\\c"), [
    "D:\\c",
    "D:\\a",
    "D:\\b",
  ]);
});

test("remember: the same folder in different case is the same folder", () => {
  // Windows paths are case-insensitive; two spellings must not both persist.
  const next = remember(["D:\\Code"], "d:\\code");
  assert.deepEqual(next, ["d:\\code"], "the newest spelling wins");
});

test("remember: caps the list", () => {
  let recent = [];
  for (let i = 0; i < RECENT_LIMIT + 5; i++) recent = remember(recent, `D:\\p${i}`);

  assert.equal(recent.length, RECENT_LIMIT);
  assert.equal(recent[0], `D:\\p${RECENT_LIMIT + 4}`, "newest kept");
  assert.equal(recent.includes("D:\\p0"), false, "oldest dropped");
});

test("remember: ignores an empty pick", () => {
  assert.deepEqual(remember(["D:\\a"], "   "), ["D:\\a"]);
  assert.deepEqual(remember(["D:\\a"], undefined), ["D:\\a"]);
});

test("loads recent roots and drops non-strings", () => {
  const withRecent = { ...DEFAULTS, recentRoots: [] };
  stubStorage({
    initial: JSON.stringify({ recentRoots: ["D:\\code", 7, null, "D:\\tmp", ""] }),
  });
  assert.deepEqual(load(withRecent, KEYS).recentRoots, ["D:\\code", "D:\\tmp"]);
});

test("caps a stored recent list an older build may have overgrown", () => {
  const withRecent = { ...DEFAULTS, recentRoots: [] };
  const many = Array.from({ length: 40 }, (_, i) => `D:\\p${i}`);
  stubStorage({ initial: JSON.stringify({ recentRoots: many }) });
  assert.equal(load(withRecent, KEYS).recentRoots.length, RECENT_LIMIT);
});

test("ignores recent roots that are not a list", () => {
  const withRecent = { ...DEFAULTS, recentRoots: [] };
  stubStorage({ initial: JSON.stringify({ recentRoots: "D:\\code" }) });
  assert.deepEqual(load(withRecent, KEYS).recentRoots, []);
});

test("stores no scan results", () => {
  // Results describe the disk at one instant; restoring them would offer
  // stale paths for deletion.
  const read = stubStorage();
  save({ root: "D:\\code", patterns: "node_modules", sort: DEFAULTS.sort });
  assert.equal(read().includes("hits"), false);
});
