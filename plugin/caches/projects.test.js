/**
 * Tests for project roots and their last-touched time.
 *
 *   node --test plugin/caches/projects.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { childIndex } from "../mft/tree.js";
import { PROJECT_MARKERS, projectOf, projectsOf } from "./projects.js";

const dir = (recordNumber, parent, name) => ({ recordNumber, parent, name, isDirectory: true });

// 5 D:\
// └ 10 code
//   ├ 11 mono            .git root                own 100
//   │ ├ 12 .git                                    own 9000
//   │ └ 13 pkgA          package.json             own 200
//   │   ├ 14 node_modules   hit                   own 9999
//   │   └ 15 src                                  own 300
//   ├ 16 lone            App.csproj               own 50
//   │ ├ 17 bin              hit                   own 5000
//   │ └ 18 nested        Cargo.toml               own 400
//   │   └ 19 target         hit                   own 8000
//   └ 20 loose           no marker
//     └ 21 __pycache__      hit
const DIRS = new Map(
  [
    dir(5, 5, "."),
    dir(10, 5, "code"),
    dir(11, 10, "mono"),
    dir(12, 11, ".git"),
    dir(13, 11, "pkgA"),
    dir(14, 13, "node_modules"),
    dir(15, 13, "src"),
    dir(16, 10, "lone"),
    dir(17, 16, "bin"),
    dir(18, 16, "nested"),
    dir(19, 18, "target"),
    dir(20, 10, "loose"),
    dir(21, 20, "__pycache__"),
  ].map((d) => [d.recordNumber, d]),
);

const TREE = {
  dirs: DIRS,
  children: childIndex(DIRS),
  // Marks are stored under lowercased pattern ids, as the stream writes them.
  marks: new Map([
    [13, new Set(["package.json"])],
    [16, new Set(["*.csproj"])],
    [18, new Set(["cargo.toml"])],
  ]),
};

const OWN = new Map([
  [11, 100],
  [12, 9000],
  [13, 200],
  [14, 9999],
  [15, 300],
  [16, 50],
  [17, 5000],
  [18, 400],
  [19, 8000],
]);

const HITS = [14, 17, 19, 21].map((n) => DIRS.get(n));
const rootOf = (n) => projectOf(TREE, DIRS.get(n), PROJECT_MARKERS)?.name ?? null;

test("project: the nearest marker holder is the root", () => {
  assert.equal(rootOf(19), "nested");
});

test("project: a marker matches by extension", () => {
  assert.equal(rootOf(17), "lone");
});

test("project: a .git root above the nearest marker wins", () => {
  assert.equal(rootOf(14), "mono");
});

test("project: no marker above is no project", () => {
  assert.equal(rootOf(21), null);
});

test("project: the volume root has no project", () => {
  assert.equal(rootOf(5), null);
});

test("project: last touched leaves out cache hits and .git", () => {
  const out = projectsOf(TREE, OWN, HITS);
  // mono: 100, pkgA 200, src 300. node_modules (9999) and .git (9000) out.
  assert.deepEqual(out.get(14), { record: DIRS.get(11), lastTouched: 300 });
});

test("project: a nested project's files count, its cache hits do not", () => {
  const out = projectsOf(TREE, OWN, HITS);
  // lone: own 50, nested 400; bin (5000) and target (8000) are hits.
  assert.equal(out.get(17).lastTouched, 400);
  assert.equal(out.get(19).lastTouched, 400);
});

test("project: a hit with no project maps to null", () => {
  assert.equal(projectsOf(TREE, OWN, HITS).get(21), null);
});

test("project: a project with no dated file has a null time", () => {
  const out = projectsOf(TREE, new Map(), HITS);
  assert.deepEqual(out.get(19), { record: DIRS.get(18), lastTouched: null });
});
