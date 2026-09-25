/**
 * Tests for the protected-folder rules, directly and through screenPaths.
 *
 *   node --test plugin/protect.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { protectionOf } from "./protect.js";
import { screenPaths } from "./zap.js";

test("protect: refuses anything inside a system subtree", () => {
  const { allowed, refused } = screenPaths([
    "C:\\Windows\\System32",
    "C:\\Program Files\\App\\build",
    "C:\\Program Files (x86)\\App\\node_modules",
    "C:\\$Recycle.Bin\\S-1-5-21-1",
    "C:\\System Volume Information\\junk",
    "D:\\windows\\temp",
  ]);
  assert.deepEqual(allowed, []);
  assert.equal(refused.length, 6);
  for (const r of refused) assert.equal(r.reason, "inside a protected system folder");
});

test("protect: the subtree folders themselves are refused", () => {
  for (const p of ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"]) {
    assert.notEqual(protectionOf(p), null, p);
  }
});

test("protect: a sibling whose name starts the same is allowed", () => {
  assert.equal(protectionOf("C:\\Windowsold\\cache"), null);
  assert.equal(protectionOf("C:\\Program Files Extra\\build"), null);
  const { allowed } = screenPaths(["C:\\Windowsold\\cache"]);
  assert.deepEqual(allowed, ["C:\\Windowsold\\cache"]);
});

test("protect: exact-only entries protect only themselves", () => {
  for (const p of ["C:\\", "C:\\Users", "C:\\Users\\dustin", "C:\\ProgramData"]) {
    assert.equal(protectionOf(p), "protected system path", p);
  }
  for (const p of [
    "C:\\Users\\dustin\\AppData\\Local\\npm-cache",
    "C:\\ProgramData\\Dbg",
  ]) {
    assert.equal(protectionOf(p), null, p);
  }
});

test("protect: more system subtrees, on any drive", () => {
  for (const p of [
    "C:\\Recovery",
    "C:\\Recovery\\WindowsRE",
    "C:\\$Extend\\x",
    "C:\\$WinREAgent",
    "C:\\$SysReset\\Logs",
    "C:\\$Windows.~BT\\Sources",
    "D:\\$Windows.~WS",
    "C:\\Boot\\en-US",
    "C:\\EFI\\Microsoft",
    "C:\\ProgramData\\Microsoft",
    "C:\\ProgramData\\Microsoft\\Windows\\Start Menu",
    "C:\\ProgramData\\Microsoft\\VisualStudio\\Other",
    "C:\\Users\\Public",
    "C:\\Users\\Public\\x",
    "C:\\Users\\Default\\AppData\\Local\\Temp",
    "C:\\Users\\Default User\\x",
    "C:\\Users\\All Users\\x",
  ]) {
    assert.equal(protectionOf(p), "inside a protected system folder", p);
  }
  for (const p of ["C:\\Recoveryold\\x", "C:\\Users\\Defaults\\x", "C:\\ProgramData\\MicrosoftEdge\\x", "C:\\a\\$tmp"]) {
    assert.equal(protectionOf(p), null, p);
  }
});

test("protect: a carve-out lets one cache through a protected subtree", () => {
  for (const p of [
    "C:\\ProgramData\\Microsoft\\VisualStudio\\Packages",
    "C:\\ProgramData\\Microsoft\\VisualStudio\\Packages\\Microsoft.VisualCpp,version=1",
  ]) {
    assert.equal(protectionOf(p), null, p);
  }
  for (const p of [
    "C:\\ProgramData\\Microsoft\\VisualStudio",
    "C:\\ProgramData\\Microsoft\\VisualStudio\\PackagesOld",
  ]) {
    assert.notEqual(protectionOf(p), null, p);
  }
});

test("protect: key folders are subtrees", () => {
  for (const p of ["C:\\Users\\dustin\\.ssh", "C:\\Users\\dustin\\.ssh\\id_ed25519", "C:\\Users\\dustin\\.gnupg\\private-keys-v1.d"]) {
    assert.equal(protectionOf(p), "inside a folder of keys", p);
  }
  assert.equal(protectionOf("C:\\Users\\dustin\\.sshx\\x"), null);
});

test("protect: AppData and its three roots are exact", () => {
  for (const p of [
    "C:\\Users\\dustin\\AppData",
    "C:\\Users\\dustin\\AppData\\Local",
    "C:\\Users\\dustin\\AppData\\Roaming",
    "C:\\Users\\dustin\\AppData\\LocalLow",
  ]) {
    assert.equal(protectionOf(p), "protected system path", p);
  }
  for (const p of [
    "C:\\Users\\dustin\\AppData\\Local\\Temp",
    "C:\\Users\\dustin\\AppData\\Roaming\\npm-cache",
    "C:\\Users\\dustin\\AppData\\LocalLow\\x",
  ]) {
    assert.equal(protectionOf(p), null, p);
  }
});

test("protect: a profile's known folders are exact", () => {
  for (const name of ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive", "OneDrive - Work", "source"]) {
    assert.equal(protectionOf(`C:\\Users\\dustin\\${name}`), "protected user folder", name);
    assert.equal(protectionOf(`C:\\Users\\dustin\\${name}\\x\\node_modules`), null, name);
  }
});

test("protect: traversal into a subtree is refused", () => {
  const { allowed, refused } = screenPaths(["C:\\Users\\dustin\\..\\..\\Windows\\Temp"]);
  assert.deepEqual(allowed, []);
  assert.equal(refused[0].path, "C:\\Windows\\Temp");
});
