/**
 * Tests for cache pack validation, path expansion and candidate building.
 *
 *   node --test plugin/caches/caches.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validatePack, expandPath, candidatePaths } from "./pack.js";
import { screenPaths } from "../zap.js";

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
  const pack = validatePack({ entries: [entry({ paths: [], drivePaths: [] })] });
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

// --- candidates ------------------------------------------------------------

const drives = ["C:\\", "D:\\"];

test("candidates: drive-relative paths are tried on every drive", () => {
  // A store can live on any volume, so "\.pnpm-store" means "check them all".
  const paths = candidatePaths(
    { paths: [], drivePaths: ["\\.pnpm-store"] },
    drives,
    env,
  );
  assert.deepEqual(paths, ["C:\\.pnpm-store", "D:\\.pnpm-store"]);
});

test("candidates: unresolvable templates are dropped", () => {
  const paths = candidatePaths(
    { paths: ["%NOPE%\\x", "~/.cargo/registry"], drivePaths: [] },
    drives,
    env,
  );
  assert.deepEqual(paths, ["C:\\Users\\dustin\\.cargo\\registry"]);
});

test("candidates: duplicates are collapsed case-insensitively", () => {
  const paths = candidatePaths(
    { paths: ["~/.cargo/registry", "C:\\Users\\dustin\\.CARGO\\Registry"], drivePaths: [] },
    drives,
    env,
  );
  assert.equal(paths.length, 1);
});

// --- per-project entries ---------------------------------------------------

test("pack: an entry with only dirNames is valid", () => {
  // .vite and target have no fixed location — they live in every project.
  const pack = validatePack({
    entries: [{ id: "vite", label: "Vite deps", dirNames: [".vite"], under: "node_modules" }],
  });
  assert.equal(pack.entries.length, 1);
  assert.deepEqual(pack.entries[0].dirNames, [".vite"]);
  assert.equal(pack.entries[0].under, "node_modules");
});

test("pack: `under` defaults to null when absent", () => {
  const pack = validatePack({
    entries: [{ id: "next", label: "Next build", dirNames: [".next"] }],
  });
  assert.equal(pack.entries[0].under, null, "matches anywhere");
});

test("pack: an entry with no paths and no dirNames is still rejected", () => {
  const pack = validatePack({
    entries: [{ id: "x", label: "X", paths: [], drivePaths: [], dirNames: [] }],
  });
  assert.equal(pack.entries.length, 0);
  assert.match(pack.errors[0].reason, /no usable paths/);
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
