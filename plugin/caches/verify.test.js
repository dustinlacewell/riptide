/**
 * Tests for the plan-time marker check. Listings are fakes; no disk.
 *
 *   node --test plugin/caches/verify.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { holds, markersOf, verifyMarkers } from "./verify.js";
import { parseNameSet } from "./matchers/nameSet.js";
import { createOffered } from "../offered.js";

const file = (name) => ({ name, isFile: () => true, isDirectory: () => false });
const folder = (name) => ({ name, isFile: () => false, isDirectory: () => true });

/** readdir over a fixed map of directory -> entries; anything else is gone. */
function fakeDisk(listing) {
  return async (dir) => {
    const entries = listing[dir.toLowerCase()];
    if (!entries) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return entries;
  };
}

const entry = (match) => ({
  match: match.map(([key, value]) => ({ key, spec: key === "dirNames" ? value : parseNameSet(value, key) })),
});

test("verify: markersOf keeps only beside and contains, as plain names", () => {
  const e = entry([
    ["dirNames", ["target"]],
    ["beside", ["Cargo.toml", "Project/"]],
    ["contains", ["*.csproj"]],
  ]);
  assert.deepEqual(markersOf(e), [
    { key: "beside", folders: ["Project"], files: ["Cargo.toml"] },
    { key: "contains", folders: [], files: ["*.csproj"] },
  ]);
});

test("verify: names match case-insensitively, *.ext by listing, folders by glob", () => {
  const need = { folders: ["cmake-build-*"], files: ["Cargo.toml", "*.csproj"] };
  assert.equal(holds([file("CARGO.TOML")], need), true);
  assert.equal(holds([file("App.CsProj")], need), true);
  assert.equal(holds([folder("CMake-Build-Debug")], need), true);
  assert.equal(holds([folder("cargo.toml")], need), false, "a folder is not the file");
  assert.equal(holds([file("cmake-build-x")], need), false, "a file is not the folder");
  assert.equal(holds([folder("target")], { folders: ["target"], files: [] }, "target"), false, "not itself");
});

test("verify: a hit whose marker went is refused, the rest kept", async () => {
  const offered = createOffered();
  const rust = entry([["dirNames", ["target"]], ["beside", ["Cargo.toml"]]]);
  const cmake = entry([["dirNames", ["build"]], ["contains", ["CMakeCache.txt"]]]);
  const paths = ["D:\\a\\target", "D:\\b\\target", "D:\\c\\build", "D:\\d\\node_modules"];
  offered.add(paths, "caches");
  offered.addMarkers("D:\\a\\target", markersOf(rust), "caches");
  offered.addMarkers("D:\\b\\target", markersOf(rust), "caches");
  offered.addMarkers("D:\\c\\build", markersOf(cmake), "caches");

  const readdir = fakeDisk({
    "d:\\a": [file("cargo.toml"), folder("target")],
    "d:\\b": [folder("target"), file("README.md")],
    "d:\\c\\build": [file("Makefile")],
  });
  const { kept, refused } = await verifyMarkers(paths, { markersOf: offered.markersOf, readdir });
  assert.deepEqual(kept, ["D:\\a\\target", "D:\\d\\node_modules"]);
  assert.deepEqual(refused, [
    { path: "D:\\b\\target", reason: "no longer next to Cargo.toml" },
    { path: "D:\\c\\build", reason: "no longer contains CMakeCache.txt" },
  ]);
});

test("verify: a folder that cannot be listed fails its check", async () => {
  const { refused } = await verifyMarkers(["E:\\gone\\target"], {
    markersOf: () => [{ key: "beside", folders: [], files: ["Cargo.toml"] }],
    readdir: fakeDisk({}),
  });
  assert.equal(refused[0].reason, "no longer next to Cargo.toml");
});

test("offered: markers go with a new scan of their source", () => {
  const offered = createOffered();
  offered.add(["D:\\a\\target"], "caches");
  offered.addMarkers("d:/a/target/", [{ key: "beside", folders: [], files: ["x"] }], "caches");
  assert.equal(offered.markersOf("D:\\a\\target").length, 1);
  offered.clear("caches");
  offered.add(["D:\\a\\target"], "caches");
  assert.deepEqual(offered.markersOf("D:\\a\\target"), []);
});
