/**
 * Tests for the tree fold: counted marks, the per-file table, and what a
 * full read keeps so a later change can be taken back out.
 *
 *   node --test plugin/mft/fold.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parseBootSector } from "./boot.js";
import { parseFileRecord } from "./record.js";
import { buildNameQuery, createMarks } from "./filenames.js";
import { NO_PARENT, createFileTable, dropFile, fileAt, putFile, toSeconds } from "./files.js";
import { addRecord, createTree, idsOfMask } from "./fold.js";
import { readTreeFrom } from "./scan.js";
import { SERIAL, buildRecord, buildVolume } from "./fakeVolume.js";

test("record: the header sequence number comes back as seq", () => {
  const parsed = parseFileRecord(buildRecord({ name: "a.txt", parent: 5, seq: 7 }), 40);
  assert.equal(parsed.seq, 7);
});

test("boot: the volume serial comes back as serial", async () => {
  const { read } = buildVolume({ records: {} });
  assert.equal(parseBootSector(await read(0n, 512)).serial, SERIAL);
});

test("marks: a count, so one leaving file keeps a sibling's mark", () => {
  const marks = createMarks(["cargo.toml"], 16);
  marks.set(9, "cargo.toml");
  marks.set(9, "cargo.toml");
  marks.set(9, "cargo.toml");
  assert.equal(marks.count(9, "cargo.toml"), 3);
  marks.unset(9, "cargo.toml");
  assert.equal(marks.count(9, "cargo.toml"), 2);
  marks.unset(9, "cargo.toml");
  assert.equal(marks.has(9, "cargo.toml"), true);
  marks.unset(9, "cargo.toml");
  assert.equal(marks.has(9, "cargo.toml"), false);
  assert.equal(marks.count(9, "cargo.toml"), 0);
  assert.equal(marks.has(9, "nope"), false);
  assert.throws(() => marks.set(1, "nope"), /unknown pattern/);
});

test("files: put, read back, drop, and grow past the end", () => {
  const table = createFileTable(4);
  putFile(table, 2, { parent: 5, size: 1234, mtime: 99, seq: 3, mask: 2 });
  assert.deepEqual(fileAt(table, 2), { parent: 5, size: 1234, mtime: 99, seq: 3, mask: 2 });
  assert.equal(fileAt(table, 1), null);
  putFile(table, 10, { parent: 6, size: 1, mtime: 0, seq: 1, mask: 0 });
  assert.ok(table.parent.length >= 11);
  assert.equal(fileAt(table, 2).size, 1234, "growing keeps what was there");
  dropFile(table, 2);
  assert.equal(fileAt(table, 2), null);
  assert.equal(table.parent[2], NO_PARENT);
  assert.equal(table.match.has(2), false);
});

test("files: seconds from ms; no time and pre-1970 times are 0", () => {
  assert.equal(toSeconds(null), 0);
  assert.equal(toSeconds(-5000), 0);
  assert.equal(toSeconds(1_999), 1);
  assert.equal(toSeconds(1e16), 0xffffffff);
});

test("fold: a file adds to its parent and remembers what it added", () => {
  const query = buildNameQuery(["Cargo.toml", "*.csproj"]);
  const tree = createTree({ size: 16, query });
  addRecord(tree, 5, { isDirectory: true, name: ".", parent: 5, size: 0n, mtime: null, seq: 5 });
  addRecord(tree, 8, { isDirectory: false, name: "Cargo.toml", parent: 5, size: 30n, mtime: 5_500, seq: 2 });
  addRecord(tree, 9, { isDirectory: false, name: "x.csproj", parent: 5, size: 70n, mtime: 1_000, seq: 1 });

  assert.equal(tree.dirs.get(5).seq, 5);
  assert.equal(tree.ownBytes.get(5), 100n);
  assert.equal(tree.ownFiles.get(5), 2);
  assert.equal(tree.ownLatest.get(5), 5_000, "whole seconds");
  assert.equal(tree.marks.count(5, "cargo.toml"), 1);
  assert.deepEqual(fileAt(tree.files, 8), { parent: 5, size: 30, mtime: 5, seq: 2, mask: tree.files.match.get(8) });
  assert.deepEqual(idsOfMask(tree.marks.ids, tree.files.match.get(9)), ["*.csproj"]);
});

test("fold: the change journal is spotted by name under $Extend", () => {
  const tree = createTree({ size: 64 });
  addRecord(tree, 40, { isDirectory: false, name: "$UsnJrnl", parent: 11, size: 0n, mtime: null, seq: 1 });
  assert.equal(tree.journalRecord, 40);
});

test("read: a full read keeps the geometry and every file's row", async () => {
  const volume = buildVolume({
    records: {
      5: { name: ".", parent: 5, isDirectory: true, seq: 5 },
      11: { name: "$Extend", parent: 5, isDirectory: true },
      20: { name: "proj", parent: 5, isDirectory: true, seq: 3 },
      21: { name: "Cargo.toml", parent: 20, size: 40, mtime: 9_000 },
      22: { name: "main.rs", parent: 20, size: 60, seq: 4 },
      30: { name: "$UsnJrnl", parent: 11 },
    },
  });
  const tree = await readTreeFrom(volume, "C:", { query: buildNameQuery(["cargo.toml"]) });

  assert.equal(tree.boot.serial, SERIAL);
  assert.equal(tree.mftRuns.length, 1);
  assert.equal(tree.recordsTotal, 64);
  assert.equal(tree.journalRecord, 30);
  assert.equal(tree.dirs.get(20).seq, 3);
  assert.equal(tree.ownBytes.get(20), 100n);
  assert.equal(tree.marks.has(20, "cargo.toml"), true);
  assert.equal(fileAt(tree.files, 22).seq, 4);
  assert.equal(fileAt(tree.files, 20), null, "a folder has no file row");
});
