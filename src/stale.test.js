/**
 * Tests for project age notes and the Untouched filter.
 *
 *   node --test src/stale.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ageText, IN_USE_TEXT, projectNote, untouchedFor } from "./stale.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25);
const ago = (days) => NOW - days * DAY;
const hit = (path, lastTouched) => ({
  path,
  project: lastTouched === undefined ? null : { path: "D:\\p", lastTouched },
});

test("age: days under a month, months under a year, then years", () => {
  assert.equal(ageText(12), "12 d");
  assert.equal(ageText(29), "29 d");
  assert.equal(ageText(30), "1 mo");
  assert.equal(ageText(215), "7 mo");
  assert.equal(ageText(364), "12 mo");
  assert.equal(ageText(365), "1 yr");
  assert.equal(ageText(800), "2 yr");
});

test("note: a project touched within 7 days is in use", () => {
  assert.deepEqual(projectNote({ lastTouched: ago(0) }, NOW), { inUse: true, text: IN_USE_TEXT });
  assert.deepEqual(projectNote({ lastTouched: ago(6.9) }, NOW), { inUse: true, text: IN_USE_TEXT });
});

test("note: an older project says how long it has been untouched", () => {
  assert.deepEqual(projectNote({ lastTouched: ago(7) }, NOW), { inUse: false, text: "untouched 7 d" });
  assert.deepEqual(projectNote({ lastTouched: ago(215) }, NOW), { inUse: false, text: "untouched 7 mo" });
});

test("note: no project or no dated file is no note", () => {
  assert.equal(projectNote(null, NOW), null);
  assert.equal(projectNote(undefined, NOW), null);
  assert.equal(projectNote({ path: "D:\\p", lastTouched: null }, NOW), null);
});

test("filter: keeps hits untouched at least the threshold", () => {
  const hits = [hit("old", ago(200)), hit("edge", ago(90)), hit("fresh", ago(89)), hit("new", ago(1))];
  assert.deepEqual(untouchedFor(hits, 90, NOW).map((h) => h.path), ["old", "edge"]);
  assert.deepEqual(untouchedFor(hits, 180, NOW).map((h) => h.path), ["old"]);
});

test("filter: a hit of unknown age is left out", () => {
  const hits = [hit("none"), hit("undated", null), hit("old", ago(400))];
  assert.deepEqual(untouchedFor(hits, 30, NOW).map((h) => h.path), ["old"]);
});
