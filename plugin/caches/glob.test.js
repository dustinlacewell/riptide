/**
 * Tests for pack name patterns.
 *
 *   node --test plugin/caches/glob.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { compileGlob, classifyName } from "./glob.js";

test("glob: matching ignores case", () => {
  assert.ok(compileGlob("cmake-build-*")("CMake-Build-Debug"));
  assert.ok(compileGlob("Cargo.toml")("CARGO.TOML"));
  assert.ok(compileGlob("*.csproj")("App.CsProj"));
});

test("glob: * is any run, ? is one character, the rest is literal", () => {
  const test1 = compileGlob("a?c*");
  assert.ok(test1("abc"));
  assert.ok(test1("abcdef"));
  assert.ok(!test1("ac"));
  // A dot is literal, not "any character".
  assert.ok(!compileGlob("*.csproj")("xcsproj"));
  assert.ok(!compileGlob("a.b")("axb"));
});

test("glob: the whole name must match", () => {
  assert.ok(!compileGlob("build")("build2"));
  assert.ok(!compileGlob("*.csproj")("a.csproj.bak"));
});

test("classify: exact, extension, glob", () => {
  assert.equal(classifyName("Cargo.toml").kind, "exact");
  assert.equal(classifyName("*.csproj").kind, "extension");
  assert.equal(classifyName("cmake-build-*").kind, "glob");
  assert.equal(classifyName("*.tar.gz").kind, "extension");
});

test("classify: broad patterns are rejected", () => {
  assert.equal(classifyName("*").kind, "rejected");
  assert.equal(classifyName("*.h").kind, "rejected", "two literal characters");
  assert.equal(classifyName("a*b").kind, "rejected");
  assert.equal(classifyName("").kind, "rejected");
});

test("classify: a path is not a name", () => {
  assert.equal(classifyName("src/target").kind, "rejected");
});

test("classify: short exact names are fine", () => {
  // Only wildcards can over-match; "go" names one folder.
  assert.equal(classifyName("go").kind, "exact");
});
