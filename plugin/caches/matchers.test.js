/**
 * Tests for the matcher registry and matchTree, on synthetic volume trees.
 *
 *   node --test plugin/caches/matchers.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validatePack } from "./pack.js";
import { matchTree } from "./match.js";
import { collectNeeds } from "./needs.js";
import { matcherFor } from "./matchers/index.js";
import { childIndex, ROOT_RECORD } from "../mft/tree.js";
import { buildNameQuery, createMarks, markFile, queryIds } from "../mft/filenames.js";

/**
 * Build a tree the way readVolumeTree would hand it over.
 *
 * `layout` maps a folder path (below the drive root) to the files in it.
 * Parent folders are created as needed. Files only become marks when the
 * entries' filters ask for them — exactly as the MFT stream behaves.
 */
function volume(layout, entries, drive = "C:") {
  const dirs = new Map([
    [ROOT_RECORD, { recordNumber: ROOT_RECORD, parent: ROOT_RECORD, name: "." }],
  ]);
  const byPath = new Map([["", ROOT_RECORD]]);
  let next = 100;

  const ensure = (full) => {
    if (byPath.has(full)) return byPath.get(full);
    const cut = full.lastIndexOf("\\");
    const parent = ensure(cut === -1 ? "" : full.slice(0, cut));
    const number = next++;
    dirs.set(number, { recordNumber: number, parent, name: full.slice(cut + 1) });
    byPath.set(full, number);
    return number;
  };

  const query = buildNameQuery(collectNeeds(entries));
  const marks = createMarks(queryIds(query));
  for (const [folder, files] of Object.entries(layout)) {
    const number = ensure(folder);
    if (!query) continue;
    for (const file of files) markFile(marks, query, file, number);
  }

  return { dirs, children: childIndex(dirs), marks, drive };
}

function entriesOf(...raw) {
  const pack = validatePack({ name: "t", entries: raw });
  assert.deepEqual(pack.errors, []);
  return pack.entries;
}

const env = {
  LOCALAPPDATA: "C:\\Users\\dustin\\AppData\\Local",
  USERPROFILE: "C:\\Users\\dustin",
};
const ctx = { env, drives: ["C:\\", "D:\\"], scope: null };

function run(layout, entries, over = {}) {
  const tree = volume(layout, entries, over.drive);
  return matchTree(tree, entries, { ...ctx, ...over });
}

const paths = (result) => result.hits.map((h) => h.path).sort();

// --- beside ----------------------------------------------------------------

const rust = { id: "rust", label: "Rust", dirNames: ["target"], beside: ["Cargo.toml"] };

test("beside: target with a sibling Cargo.toml matches", () => {
  const entries = entriesOf(rust);
  const result = run({ "code\\app": ["Cargo.toml"], "code\\app\\target": [] }, entries);
  assert.deepEqual(paths(result), ["C:\\code\\app\\target"]);
});

test("beside: target without a sibling Cargo.toml is not matched", () => {
  const entries = entriesOf(rust);
  const result = run(
    { "code\\java": ["pom.xml"], "code\\java\\target": [], "code\\app\\sub": ["Cargo.toml"], "code\\app\\target": [] },
    entries,
  );
  assert.deepEqual(paths(result), []);
});

test("beside: *.csproj matches any project name", () => {
  const entries = entriesOf({
    id: "dotnet", label: ".NET", dirNames: ["bin", "obj"], beside: ["*.csproj"],
  });
  const result = run(
    {
      "src\\Web": ["Company.Web.csproj"],
      "src\\Web\\bin": [],
      "src\\Web\\obj": [],
      "src\\docs\\bin": ["run.sh"],
    },
    entries,
  );
  assert.deepEqual(paths(result), ["C:\\src\\Web\\bin", "C:\\src\\Web\\obj"]);
});

test("beside: a trailing slash means a sibling folder", () => {
  const entries = entriesOf({
    id: "unity", label: "Unity", dirNames: ["Library"], beside: ["ProjectSettings/"],
  });
  const result = run(
    {
      "games\\Proj\\ProjectSettings": [],
      "games\\Proj\\Library": [],
      // A file named ProjectSettings is not the folder.
      "other\\Library": [],
      "other": ["ProjectSettings"],
    },
    entries,
  );
  assert.deepEqual(paths(result), ["C:\\games\\Proj\\Library"]);
});

test("beside: a folder rule does not count the located folder itself", () => {
  const entries = entriesOf({ id: "x", label: "X", dirNames: ["Library"], beside: ["Library/"] });
  assert.deepEqual(paths(run({ "p\\Library": [] }, entries)), []);
});

// --- contains --------------------------------------------------------------

test("contains: tests the located folder's own files", () => {
  const entries = entriesOf({
    id: "cmake", label: "CMake", dirNames: ["build", "cmake-build-*"], contains: ["CMakeCache.txt"],
  });
  const result = run(
    {
      "c\\one\\build": ["CMakeCache.txt"],
      "c\\two\\cmake-build-debug": ["CMakeCache.txt"],
      "c\\three\\build": ["output.js"],
      // Beside is not inside.
      "c\\four": ["CMakeCache.txt"],
      "c\\four\\build": [],
    },
    entries,
  );
  assert.deepEqual(paths(result), ["C:\\c\\one\\build", "C:\\c\\two\\cmake-build-debug"]);
});

// --- under -----------------------------------------------------------------

test("under: keeps today's immediate-parent rule", () => {
  const entries = entriesOf({ id: "vite", label: "Vite", dirNames: [".vite"], under: "node_modules" });
  const result = run({ "p\\node_modules\\.vite": [], "p\\.vite": [] }, entries);
  assert.deepEqual(paths(result), ["C:\\p\\node_modules\\.vite"]);
});

// --- paths and wildcards ---------------------------------------------------

test("paths: a wildcard segment fans out to every matching child", () => {
  const entries = entriesOf({
    id: "jb", label: "JB", paths: ["%LOCALAPPDATA%\\JetBrains\\*\\caches"],
  });
  const local = "Users\\dustin\\AppData\\Local\\JetBrains";
  const result = run(
    {
      [`${local}\\IntelliJIdea2024.1\\caches`]: [],
      [`${local}\\PyCharm2024.2\\caches`]: [],
      [`${local}\\Toolbox\\logs`]: [],
    },
    entries,
  );
  assert.deepEqual(paths(result), [
    `C:\\${local}\\IntelliJIdea2024.1\\caches`,
    `C:\\${local}\\PyCharm2024.2\\caches`,
  ]);
});

test("paths: a literal segment still matches exactly, ignoring case", () => {
  const entries = entriesOf({ id: "ff", label: "FF", paths: ["C:\\Moz\\Profiles\\*\\cache2"] });
  const result = run(
    {
      "moz\\profiles\\abc.default\\CACHE2": [],
      "Moz\\Profiles\\abc.default\\cache2-old": [],
      "Moz\\ProfilesX\\abc.default\\cache2": [],
    },
    entries,
  );
  assert.deepEqual(paths(result), ["C:\\moz\\profiles\\abc.default\\CACHE2"]);
});

test("paths: unset variables are skipped, and paths only match their own drive", () => {
  const entries = entriesOf({
    id: "c", label: "C", paths: ["%NOPE%\\x", "~/.cargo/registry", "D:\\cache\\x"],
  });
  const tree = { "Users\\dustin\\.cargo\\registry": [], "cache\\x": [] };
  assert.deepEqual(paths(run(tree, entries)), ["C:\\Users\\dustin\\.cargo\\registry"]);
  assert.deepEqual(paths(run(tree, entries, { drive: "D:" })), ["D:\\cache\\x"]);
});

test("paths: drives lists only the drives the paths name", () => {
  const [entry] = entriesOf({ id: "c", label: "C", paths: ["~/.x", "D:\\y", "%NOPE%\\z"] });
  const spec = entry.match[0].spec;
  assert.deepEqual(matcherFor("paths").drives(spec, ctx).sort(), ["C:", "D:"]);
});

test("drivePaths: tried on every drive", () => {
  const [entry] = entriesOf({ id: "p", label: "P", drivePaths: ["\\.pnpm-store"] });
  assert.equal(matcherFor("drivePaths").drives(entry.match[0].spec, ctx), "all");
  for (const drive of ["C:", "D:"]) {
    const result = run({ ".pnpm-store": [] }, [entry], { drive });
    assert.deepEqual(paths(result), [`${drive}\\.pnpm-store`], "a drive-root store is allowed");
  }
});

test("paths: two templates reaching one folder report it once", () => {
  const entries = entriesOf({
    id: "c", label: "C", paths: ["~/.cargo/registry", "C:\\Users\\dustin\\.CARGO\\Registry"],
  });
  assert.equal(run({ "Users\\dustin\\.cargo\\registry": [] }, entries).hits.length, 1);
});

// --- nesting and dedupe ----------------------------------------------------

test("nesting: a hit inside another hit is dropped", () => {
  const entries = entriesOf(
    rust,
    { id: "cmf", label: "CMakeFiles", dirNames: ["CMakeFiles"] },
  );
  const result = run(
    {
      "w": ["Cargo.toml"],
      "w\\target": [],
      "w\\target\\debug\\CMakeFiles": [],
      "w\\crates\\a": ["Cargo.toml"],
      "w\\crates\\a\\target": [],
    },
    entries,
  );
  assert.deepEqual(paths(result), ["C:\\w\\crates\\a\\target", "C:\\w\\target"]);
});

test("dedupe: a folder claimed by two entries goes to the earlier one", () => {
  const entries = entriesOf(
    { id: "first", label: "First", dirNames: ["cache"] },
    { id: "second", label: "Second", paths: ["C:\\p\\cache"] },
  );
  const result = run({ "p\\cache": [] }, entries);
  assert.deepEqual(result.hits.map((h) => h.entry.id), ["first"]);
});

// --- scope -----------------------------------------------------------------

test("scope: only hits under the root are kept", () => {
  const entries = entriesOf(rust);
  const result = run(
    { "code\\a": ["Cargo.toml"], "code\\a\\target": [], "code-old\\b": ["Cargo.toml"], "code-old\\b\\target": [] },
    entries,
    { scope: "c:\\code" },
  );
  assert.deepEqual(paths(result), ["C:\\code\\a\\target"]);
});

// --- safety ----------------------------------------------------------------

test("safety: a wildcard never reaches into a protected folder", () => {
  // "\*\cache" would otherwise reach C:\Windows\cache and every user
  // profile's cache; each protected branch is pruned during the walk.
  const entries = entriesOf({ id: "w", label: "W", drivePaths: ["\\*\\cache", "\\Users\\*\\cache"] });
  const result = run(
    {
      "Windows\\cache": [],
      "Program Files\\cache": [],
      "ProgramData\\cache": [],
      "Users\\dustin\\cache": [],
      "tools\\cache": [],
    },
    entries,
  );
  assert.deepEqual(paths(result), ["C:\\tools\\cache"]);
});

test("safety: no wildcard result is a drive root or protected folder", () => {
  const entries = entriesOf(
    { id: "a", label: "A", drivePaths: ["\\*\\Users"] },
    { id: "b", label: "B", paths: ["C:\\*\\Windows"] },
  );
  const result = run(
    { "x\\Users": [], "x\\Windows": [], "Users": [], "Windows": [] },
    entries,
  );
  for (const hit of result.hits) {
    assert.doesNotMatch(hit.path, /^[A-Z]:\\?$/i);
    assert.doesNotMatch(hit.path, /^[A-Z]:\\(Windows|Users|Program Files|ProgramData)$/i);
  }
  assert.deepEqual(paths(result), ["C:\\x\\Users", "C:\\x\\Windows"]);
});

test("safety: a wildcard name at the drive root fails the depth rule", () => {
  // A named store at a drive root is allowed; a glob-matched one is not.
  const entries = entriesOf({ id: "g", label: "G", dirNames: ["cmake-build-*"] });
  const result = run({ "cmake-build-debug": [], "p\\cmake-build-debug": [] }, entries);
  assert.deepEqual(paths(result), ["C:\\p\\cmake-build-debug"]);
  assert.equal(result.refused.length, 1);
});

test("safety: a located protected path is refused even without wildcards", () => {
  const entries = entriesOf({ id: "bad", label: "Bad", paths: ["C:\\Windows"] });
  const result = run({ "Windows": [] }, entries);
  assert.deepEqual(result.hits, []);
  assert.match(result.refused[0].reason, /protected/);
});

test("safety: a literal segment cannot carry a wildcard into a system folder", () => {
  const entries = entriesOf({ id: "w", label: "W", drivePaths: ["\\Windows\\*\\config"] });
  const result = run({ "Windows\\System32\\config": [] }, entries);
  assert.deepEqual(result.hits, []);
});

test("safety: a pack path inside a system folder yields nothing", () => {
  const entries = entriesOf(
    { id: "a", label: "A", paths: ["C:\\Program Files\\App\\cache"] },
    { id: "b", label: "B", dirNames: ["build"], contains: ["CMakeCache.txt"] },
  );
  const result = run(
    { "Program Files\\App\\cache": [], "Program Files (x86)\\X\\build": ["CMakeCache.txt"] },
    entries,
  );
  assert.deepEqual(result.hits, []);
  assert.equal(result.refused.length, 2);
});

test("safety: a sibling that only shares a prefix is not refused", () => {
  const entries = entriesOf({ id: "a", label: "A", paths: ["C:\\Windowsold\\x", "C:\\Program Filesx\\y"] });
  const result = run({ "Windowsold\\x": [], "Program Filesx\\y": [] }, entries);
  assert.deepEqual(paths(result), ["C:\\Program Filesx\\y", "C:\\Windowsold\\x"]);
});

test("safety: user-profile and ProgramData caches still resolve", () => {
  // The subtree rule covers system folders only; caches live under these.
  const entries = entriesOf(
    { id: "a", label: "A", paths: ["%LOCALAPPDATA%\\pnpm\\store"] },
    { id: "b", label: "B", paths: ["C:\\ProgramData\\Dbg"] },
  );
  const result = run(
    { "Users\\dustin\\AppData\\Local\\pnpm\\store": [], "ProgramData\\Dbg": [] },
    entries,
  );
  assert.equal(result.hits.length, 2);
});

test("safety: the walk refuses . and .. segments", async () => {
  const { walkSegments } = await import("./matchers/segments.js");
  const tree = volume({ "a\\b": [] }, []);
  assert.deepEqual(walkSegments(tree, ["a", "b", ".."]), []);
  assert.deepEqual(walkSegments(tree, ["a", ".", "b"]), []);
});

// --- needs -----------------------------------------------------------------

test("needs: only file patterns from filters, merged", () => {
  const entries = entriesOf(
    rust,
    { id: "u", label: "U", dirNames: ["Library"], beside: ["ProjectSettings/"] },
    { id: "d", label: "D", dirNames: ["bin"], beside: ["*.csproj", "CARGO.toml"] },
    { id: "v", label: "V", dirNames: [".vite"], under: "node_modules" },
  );
  assert.deepEqual(collectNeeds(entries).sort(), ["*.csproj", "cargo.toml"]);
});

test("needs: no file filters means no query", () => {
  const entries = entriesOf({ id: "v", label: "V", dirNames: [".vite"], under: "node_modules" });
  assert.equal(buildNameQuery(collectNeeds(entries)), null);
});
