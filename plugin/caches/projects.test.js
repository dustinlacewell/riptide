/**
 * Tests for project roots and their last-touched time.
 *
 *   node --test plugin/caches/projects.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { childIndex } from "../mft/tree.js";
import { createMarks, markFile, queryIds } from "../mft/filenames.js";
import { PROJECT_MARKERS, projectOf, projectsOf } from "./projects.js";
import { projectNeeds } from "./needs.js";
import { validatePack } from "./pack.js";
import { resolveEntries } from "./resolve.js";

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

// Marks are stored under lowercased pattern ids, as the stream writes them.
const MARKS = createMarks(["package.json", "*.csproj", "cargo.toml"]);
MARKS.set(13, "package.json");
MARKS.set(16, "*.csproj");
MARKS.set(18, "cargo.toml");

const TREE = {
  dirs: DIRS,
  children: childIndex(DIRS),
  marks: MARKS,
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

// --- through resolveEntries ------------------------------------------------

/**
 * A readTree stand-in: builds the volume from `layout` (folder -> [file,
 * mtime] pairs) and marks files with the query the resolver asks for,
 * exactly as the stream does.
 */
function fakeReadTree(layout) {
  return async (drive, { query }) => {
    const dirs = new Map([[5, dir(5, 5, ".")]]);
    const byPath = new Map([["", 5]]);
    let next = 100;
    const ensure = (full) => {
      if (byPath.has(full)) return byPath.get(full);
      const cut = full.lastIndexOf("\\");
      const parent = ensure(cut === -1 ? "" : full.slice(0, cut));
      const number = next++;
      dirs.set(number, dir(number, parent, full.slice(cut + 1)));
      byPath.set(full, number);
      return number;
    };

    const ownBytes = new Map();
    const ownFiles = new Map();
    const ownLatest = new Map();
    const marks = createMarks(queryIds(query));
    for (const [folder, files] of Object.entries(layout)) {
      const number = ensure(folder);
      for (const [name, mtime] of files) {
        ownBytes.set(number, (ownBytes.get(number) ?? 0n) + 10n);
        ownFiles.set(number, (ownFiles.get(number) ?? 0) + 1);
        ownLatest.set(number, Math.max(ownLatest.get(number) ?? 0, mtime));
        if (query) markFile(marks, query, name, number);
      }
    }
    return { dirs, ownBytes, ownFiles, ownLatest, marks, drive, recordsDone: 0 };
  };
}

const LAYOUT = {
  "code\\app": [["package.json", 1_000]],
  "code\\app\\src": [["main.js", 2_000]],
  "code\\app\\node_modules": [["huge.js", 9_000]],
  "code\\repo": [],
  "code\\repo\\.git": [["index", 9_500]],
  "code\\repo\\lib\\node_modules": [["x.js", 8_000]],
  "code\\repo\\lib": [["a.py", 3_000]],
  "loose\\node_modules": [["y.js", 7_000]],
  "cache\\pip": [["wheel", 6_000]],
};

async function resolveLayout() {
  const { entries } = validatePack({
    name: "t",
    entries: [
      { id: "nm", label: "node_modules", dirNames: ["node_modules"] },
      { id: "pip", label: "pip", paths: ["C:\\cache\\pip"] },
    ],
  });
  const { found } = await resolveEntries(entries, {
    drives: ["C:\\"],
    root: "C:\\",
    readTree: fakeReadTree(LAYOUT),
  });
  return new Map(found.map((h) => [h.path, h.project]));
}

test("resolve: a per-project hit carries its project and last-touched time", async () => {
  const byPath = await resolveLayout();
  // package.json is marked only because per-project entries ask for markers.
  assert.deepEqual(byPath.get("C:\\code\\app\\node_modules"), {
    path: "C:\\code\\app",
    lastTouched: 2_000,
  });
  assert.deepEqual(byPath.get("C:\\code\\repo\\lib\\node_modules"), {
    path: "C:\\code\\repo",
    lastTouched: 3_000,
  });
});

test("resolve: no project root, or a cache that is not per-project, is null", async () => {
  const byPath = await resolveLayout();
  assert.equal(byPath.get("C:\\loose\\node_modules"), null);
  assert.equal(byPath.get("C:\\cache\\pip"), null);
});

test("needs: project markers are asked for only with a per-project entry", () => {
  const { entries } = validatePack({
    name: "t",
    entries: [
      { id: "nm", label: "node_modules", dirNames: ["node_modules"] },
      { id: "pip", label: "pip", paths: ["C:\\cache\\pip"] },
    ],
  });
  assert.deepEqual(projectNeeds(entries), PROJECT_MARKERS);
  assert.deepEqual(projectNeeds(entries.filter((e) => !e.perProject)), []);
});

test("project: a project with no dated file has a null time", () => {
  const out = projectsOf(TREE, new Map(), HITS);
  assert.deepEqual(out.get(19), { record: DIRS.get(18), lastTouched: null });
});
