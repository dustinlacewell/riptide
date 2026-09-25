/**
 * Tests for the MFT file-name query.
 *
 *   node --test plugin/mft/filenames.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildNameQuery, createMarks, matchName, markFile, markId, queryIds } from "./filenames.js";

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

test("query ids: exact names and extensions, as markId spells them", () => {
  const query = buildNameQuery(["Cargo.toml", "*.csproj"]);
  assert.deepEqual(queryIds(query).sort(), [markId("*.csproj"), markId("Cargo.toml")].sort());
  assert.deepEqual(queryIds(null), []);
});

test("marks: only requested patterns are recorded, against the parent", () => {
  const query = buildNameQuery(["Cargo.toml", "*.csproj"]);
  const marks = createMarks(queryIds(query), 16);
  const cargo = markId("Cargo.toml");
  const csproj = markId("*.csproj");

  markFile(marks, query, "Cargo.toml", 10);
  markFile(marks, query, "README.md", 10);
  markFile(marks, query, "Web.csproj", 11);
  markFile(marks, query, "main.rs", 12);

  assert.equal(marks.has(10, cargo), true);
  assert.equal(marks.has(10, csproj), false);
  assert.equal(marks.has(11, csproj), true);
  assert.equal(marks.has(11, cargo), false);
  assert.equal(marks.has(12, cargo) || marks.has(12, csproj), false);
});

test("marks: a repeat match keeps the mark", () => {
  const query = buildNameQuery(["*.csproj"]);
  const marks = createMarks(queryIds(query));
  markFile(marks, query, "a.csproj", 1);
  markFile(marks, query, "b.csproj", 1);
  assert.equal(marks.has(1, "*.csproj"), true);
});

test("marks: an unknown pattern is never held, and cannot be set", () => {
  const marks = createMarks(["cargo.toml"]);
  assert.equal(marks.has(1, "go.mod"), false);
  assert.throws(() => marks.set(1, "go.mod"), /unknown pattern/);
});

test("marks: many patterns over many folders stay independent", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `marker${i}.txt`);
  const marks = createMarks(ids, 1000);
  // Pattern i marks every folder divisible by i + 2, well past any cap on
  // how many folders a pattern may mark.
  for (let dir = 0; dir < 5000; dir++) {
    ids.forEach((id, i) => {
      if (dir % (i + 2) === 0) marks.set(dir, id);
    });
  }
  for (let dir = 0; dir < 5000; dir++) {
    ids.forEach((id, i) => assert.equal(marks.has(dir, id), dir % (i + 2) === 0));
  }
});
