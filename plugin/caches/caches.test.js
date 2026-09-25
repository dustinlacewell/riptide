/**
 * Tests for cache pack validation, path expansion and candidate building.
 *
 *   node --test plugin/caches/caches.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePack, whereOf } from "./pack.js";
import { expandPath } from "./expand.js";
import { loadPacks } from "./load.js";
import { screenPaths } from "../zap.js";

const specOf = (entry, key) => entry.match.find((m) => m.key === key)?.spec ?? null;

const entry = (over = {}) => ({
  id: "pnpm",
  label: "pnpm store",
  paths: ["%LOCALAPPDATA%\\pnpm\\store"],
  ...over,
});

// --- validation ------------------------------------------------------------

test("pack: keeps well-formed entries", () => {
  const pack = validatePack({ name: "p", entries: [entry()] });
  assert.equal(pack.entries.length, 1);
  assert.equal(pack.errors.length, 0);
  assert.equal(pack.entries[0].pack, "p");
});

test("pack: one bad entry does not lose the rest", () => {
  // A shared pack is someone else's file. A single malformed line should
  // cost that line, not every other cache in the file.
  const pack = validatePack({
    name: "p",
    entries: [entry(), { id: "broken" }, entry({ id: "npm" })],
  });
  assert.equal(pack.entries.length, 2);
  assert.equal(pack.errors.length, 1);
  assert.match(pack.errors[0].reason, /missing label/);
});

test("pack: an entry with no usable paths is rejected", () => {
  const pack = validatePack({ entries: [{ id: "x", label: "X", cost: "none" }] });
  assert.equal(pack.entries.length, 0);
  assert.match(pack.errors[0].reason, /no usable paths/);
});

test("pack: duplicate ids inside one pack are rejected", () => {
  const pack = validatePack({ entries: [entry(), entry()] });
  assert.equal(pack.entries.length, 1);
  assert.match(pack.errors[0].reason, /duplicate id/);
});

test("pack: a non-object or entry-less file throws", () => {
  assert.throws(() => validatePack([], "x.json"), /expected an object/);
  assert.throws(() => validatePack({}, "x.json"), /id.*entries/);
});

test("pack: a file may be a single entry with no wrapper", () => {
  // One cache per file is the normal shape — packs/pnpm-store.json is the
  // entry itself, not an object wrapping a one-item array.
  const pack = validatePack(
    { id: "pnpm-store", label: "pnpm store", paths: ["~/.pnpm-store"] },
    "pnpm-store.json",
  );
  assert.equal(pack.entries.length, 1);
  assert.equal(pack.entries[0].id, "pnpm-store");
});

test("pack: a single-entry file takes its group from `pack`", () => {
  const pack = validatePack(
    { id: "uv-cache", label: "uv", paths: ["~/.cache/uv"], pack: "python" },
    "uv-cache.json",
  );
  assert.equal(pack.entries[0].pack, "python");
});

test("pack: a single-entry file without `pack` falls back to its filename", () => {
  const pack = validatePack(
    { id: "thing", label: "Thing", paths: ["~/.thing"] },
    "thing.json",
  );
  assert.equal(pack.entries[0].pack, "thing");
});

// --- expansion -------------------------------------------------------------

const env = {
  LOCALAPPDATA: "C:\\Users\\dustin\\AppData\\Local",
  USERPROFILE: "C:\\Users\\dustin",
};

test("expand: %VAR% is substituted", () => {
  assert.equal(
    expandPath("%LOCALAPPDATA%\\pnpm\\store", env),
    "C:\\Users\\dustin\\AppData\\Local\\pnpm\\store",
  );
});

test("expand: ~ becomes the home directory", () => {
  assert.equal(expandPath("~/.cargo/registry", env), "C:\\Users\\dustin\\.cargo\\registry");
});

test("expand: an unset variable yields null, not a broken path", () => {
  // A Linux-only path on a Windows machine is ordinary, not an error — but
  // it must not expand to something like "\\pip\\cache" and get used.
  assert.equal(expandPath("$XDG_CACHE_HOME/pip", env), null);
  assert.equal(expandPath("%NOPE%\\cache", env), null);
});

test("expand: a plain absolute path passes through", () => {
  assert.equal(expandPath("D:\\.pnpm-store", env), "D:\\.pnpm-store");
});

// --- per-project entries ---------------------------------------------------

test("pack: an entry with only dirNames is valid", () => {
  // .vite and target have no fixed location — they live in every project.
  const pack = validatePack({
    entries: [{ id: "vite", label: "Vite deps", dirNames: [".vite"], under: "node_modules" }],
  });
  assert.equal(pack.entries.length, 1);
  const [vite] = pack.entries;
  assert.deepEqual(specOf(vite, "dirNames").names.map((n) => n.pattern), [".vite"]);
  assert.equal(specOf(vite, "under").label, "node_modules");
  assert.equal(vite.perProject, true);
});

test("pack: `under` is absent when not given", () => {
  const pack = validatePack({
    entries: [{ id: "next", label: "Next build", dirNames: [".next"] }],
  });
  assert.equal(specOf(pack.entries[0], "under"), null, "matches anywhere");
});

test("pack: where describes each rule for the settings list", () => {
  const pack = validatePack({
    entries: [{ id: "vite", label: "Vite", dirNames: [".vite"], under: "node_modules" }],
  });
  assert.deepEqual(whereOf(pack.entries[0]), ["folders named .vite", "inside node_modules"]);
});

// --- registry-driven validation --------------------------------------------

test("pack: an unknown key is rejected, not ignored", () => {
  // A misspelt filter would otherwise silently widen what gets deleted.
  const pack = validatePack({
    entries: [{ id: "t", label: "T", dirNames: ["target"], besides: ["Cargo.toml"] }],
  });
  assert.equal(pack.entries.length, 0);
  assert.match(pack.errors[0].reason, /unknown key "besides"/);
});

test("pack: a filter-only entry is rejected", () => {
  const pack = validatePack({
    entries: [{ id: "t", label: "T", beside: ["Cargo.toml"] }],
  });
  assert.equal(pack.entries.length, 0);
  assert.match(pack.errors[0].reason, /no usable paths/);
});

test("pack: a too-broad name pattern is rejected", () => {
  const pack = validatePack({
    entries: [
      { id: "a", label: "A", dirNames: ["*"] },
      { id: "b", label: "B", dirNames: ["x"], beside: ["*.h"] },
      { id: "c", label: "C", dirNames: ["x"], beside: ["foo*.txt"] },
    ],
  });
  assert.equal(pack.entries.length, 0);
  assert.equal(pack.errors.length, 3);
});

test("pack: a path whose last segment is a wildcard is rejected", () => {
  // "every child of X" is never a cache; a template must name the folder.
  const pack = validatePack({
    entries: [{ id: "a", label: "A", paths: ["%LOCALAPPDATA%\\JetBrains\\*"] }],
  });
  assert.equal(pack.entries.length, 0);
  assert.match(pack.errors[0].reason, /last segment/);
});

test("pack: caution text makes the entry risk caution", () => {
  const pack = validatePack({
    entries: [
      entry({ id: "a", caution: "Slow to rebuild." }),
      entry({ id: "b" }),
    ],
  });
  assert.equal(pack.entries[0].risk, "caution");
  assert.equal(pack.entries[0].riskNote, "Slow to rebuild.");
  assert.equal(pack.entries[1].risk, "safe");
  assert.equal(pack.entries[1].riskNote, null);
});

test("packs: every file in packs/ loads without error", async () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packs");
  const { entries, errors } = await loadPacks(dir);
  assert.deepEqual(errors, []);
  assert.ok(entries.length > 80);
});

test("pack: a present key with an empty list is an error, not absent", () => {
  const pack = validatePack({
    entries: [
      { id: "a", label: "A", paths: [], dirNames: ["x"] },
      { id: "b", label: "B", dirNames: ["target"], beside: [] },
      { id: "c", label: "C", dirNames: ["target"], beside: [""] },
      { id: "d", label: "D", dirNames: ["target"], contains: [42] },
      { id: "e", label: "E", dirNames: ["target", "  "] },
    ],
  });
  assert.equal(pack.entries.length, 0, "a blank filter must not silently widen");
  assert.equal(pack.errors.length, 5);
  assert.match(pack.errors[0].reason, /paths is empty/);
  assert.match(pack.errors[1].reason, /beside is empty/);
  assert.match(pack.errors[2].reason, /beside has a blank or non-string/);
  assert.match(pack.errors[3].reason, /contains has a blank or non-string/);
});

test("pack: . and .. segments are rejected at load", () => {
  // Expansion normalizes the path, so "…\*\x\.." would end on the wildcard.
  const pack = validatePack({
    entries: [
      { id: "a", label: "A", paths: ["%USERPROFILE%\\*\\x\\.."] },
      { id: "b", label: "B", paths: ["C:\\a\\.\\b"] },
      { id: "c", label: "C", drivePaths: ["\\x\\..\\y"] },
    ],
  });
  assert.equal(pack.entries.length, 0);
  for (const e of pack.errors) assert.match(e.reason, /"\." and "\.\." segments/);
});

// --- screening -------------------------------------------------------------

test("screen: a drive-root cache is allowed when depth is waived", () => {
  // D:\.pnpm-store is a real pnpm store location. The depth rule exists to
  // catch pattern typos, and a pack names an exact path instead.
  const strict = screenPaths(["D:\\.pnpm-store"]);
  assert.equal(strict.allowed.length, 0, "the Zap tab still refuses it");

  const waived = screenPaths(["D:\\.pnpm-store"], { requireDepth: false });
  assert.deepEqual(waived.allowed, ["D:\\.pnpm-store"]);
});

test("screen: waiving depth does not unprotect system paths", () => {
  // This is the check that must survive the waiver.
  const { allowed, refused } = screenPaths(
    ["C:\\Windows", "C:\\", "D:\\", "C:\\Users", "C:\\Program Files"],
    { requireDepth: false },
  );
  assert.equal(allowed.length, 0, "none of these may ever be deleted");
  assert.equal(refused.length, 5);
});
