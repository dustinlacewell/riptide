/**
 * Tests for the MFT file-name query.
 *
 *   node --test plugin/mft/filenames.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildNameQuery, matchName, markFile, markId } from "./filenames.js";

test("query: empty pattern list means no query", () => {
  // No query lets the stream skip the per-file test entirely.
  assert.equal(buildNameQuery([]), null);
});

test("query: exact names match regardless of case", () => {
  const query = buildNameQuery(["Cargo.toml"]);
  assert.deepEqual(matchName(query, "CARGO.TOML"), ["cargo.toml"]);
  assert.deepEqual(matchName(query, "Cargo.lock"), []);
});

test("query: extensions match any base name", () => {
  const query = buildNameQuery(["*.csproj"]);
  assert.deepEqual(matchName(query, "My.App.csproj"), ["*.csproj"]);
  assert.deepEqual(matchName(query, "App.csproj.user"), []);
});

test("query: a multi-dot extension matches", () => {
  const query = buildNameQuery(["*.tar.gz"]);
  assert.deepEqual(matchName(query, "a.tar.gz"), ["*.tar.gz"]);
});

test("query: unsupported shapes throw", () => {
  assert.throws(() => buildNameQuery(["foo*.txt"]), /unsupported/);
});

test("marks: only requested patterns are recorded, against the parent", () => {
  const query = buildNameQuery(["Cargo.toml", "*.csproj"]);
  const marks = new Map();

  markFile(marks, query, "Cargo.toml", 10);
  markFile(marks, query, "README.md", 10);
  markFile(marks, query, "Web.csproj", 11);
  markFile(marks, query, "main.rs", 12);

  assert.deepEqual([...marks.keys()].sort(), [10, 11]);
  assert.deepEqual([...marks.get(10)], [markId("Cargo.toml")]);
  assert.deepEqual([...marks.get(11)], [markId("*.csproj")]);
});

test("marks: a repeat match adds nothing", () => {
  const query = buildNameQuery(["*.csproj"]);
  const marks = new Map();
  assert.equal(markFile(marks, query, "a.csproj", 1), 1);
  assert.equal(markFile(marks, query, "b.csproj", 1), 0);
});
