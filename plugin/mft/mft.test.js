/**
 * Tests for the pure MFT parsers. Everything here runs on synthetic buffers,
 * so none of it needs a real volume or elevation.
 *
 *   node --test plugin/mft/mft.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parseBootSector } from "./boot.js";
import { decodeRunList, runsToByteRanges } from "./runlist.js";
import { applyFixup, parseFileRecord } from "./record.js";
import { resolvePath, subtreeSizes, findOutermostMatches, indexRecords } from "./tree.js";

// --- boot sector -----------------------------------------------------------

function makeBootSector({ bytesPerSector = 512, sectorsPerCluster = 8, mftCluster = 786432n, clustersPerRecord = -10 } = {}) {
  const buf = Buffer.alloc(512);
  buf.write("NTFS    ", 3, "latin1");
  buf.writeUInt16LE(bytesPerSector, 0x0b);
  buf.writeUInt8(sectorsPerCluster, 0x0d);
  buf.writeBigUInt64LE(mftCluster, 0x30);
  buf.writeInt8(clustersPerRecord, 0x40);
  return buf;
}

test("boot sector: reads geometry and computes MFT byte offset", () => {
  const boot = parseBootSector(makeBootSector());
  assert.equal(boot.bytesPerSector, 512);
  assert.equal(boot.bytesPerCluster, 4096);
  assert.equal(boot.mftOffset, 786432n * 4096n);
});

test("boot sector: negative clustersPerRecord is a log2 byte size", () => {
  // -10 means 2^10 = 1024 bytes, NOT 10 clusters. This is the field that
  // trips people up: record is 1KB while the cluster is 4KB.
  assert.equal(parseBootSector(makeBootSector()).bytesPerFileRecord, 1024);
});

test("boot sector: positive clustersPerRecord counts clusters", () => {
  const boot = parseBootSector(makeBootSector({ clustersPerRecord: 2 }));
  assert.equal(boot.bytesPerFileRecord, 8192);
});

test("boot sector: rejects a non-NTFS volume", () => {
  const buf = makeBootSector();
  buf.write("FAT32   ", 3, "latin1");
  assert.throws(() => parseBootSector(buf), /not an NTFS volume/);
});

// --- run lists -------------------------------------------------------------

test("run list: decodes a single run", () => {
  // header 0x21: 1 length byte, 2 offset bytes
  const buf = Buffer.from([0x21, 0x10, 0x00, 0x01, 0x00]);
  const runs = decodeRunList(buf);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].length, 16n);
  assert.equal(runs[0].lcn, 256n);
});

test("run list: offsets are deltas, and may be negative", () => {
  const buf = Buffer.from([
    0x21, 0x10, 0x00, 0x01, // run 1: len 16 at LCN 256
    0x21, 0x08, 0x00, 0xff, // run 2: len 8, delta -256 -> LCN 0
    0x00,
  ]);
  const runs = decodeRunList(buf);
  assert.equal(runs[0].lcn, 256n);
  assert.equal(runs[1].lcn, 0n, "second run moves backwards on the volume");
  assert.equal(runs[1].vcn, 16n, "VCN continues forward regardless");
});

test("run list: a zero-length offset field marks a sparse hole", () => {
  const buf = Buffer.from([
    0x21, 0x10, 0x00, 0x01, // 16 clusters at 256
    0x01, 0x08,             // 8 clusters, no offset -> sparse
    0x11, 0x04, 0x10,       // 4 clusters, delta +16
    0x00,
  ]);
  const runs = decodeRunList(buf);
  assert.equal(runs[1].lcn, null);
  assert.equal(runs[2].lcn, 272n, "LCN does not advance across a hole");

  const ranges = runsToByteRanges(runs, 4096);
  assert.equal(ranges.length, 2, "sparse runs produce no readable range");
});

test("run list: stops at the terminator", () => {
  const buf = Buffer.from([0x21, 0x10, 0x00, 0x01, 0x00, 0xff, 0xff, 0xff]);
  assert.equal(decodeRunList(buf).length, 1);
});

// --- fixups ----------------------------------------------------------------

test("fixup: restores the bytes NTFS overwrote at each sector end", () => {
  const rec = Buffer.alloc(1024);
  rec.write("FILE", 0, "latin1");
  rec.writeUInt16LE(0x30, 0x04); // USA offset
  rec.writeUInt16LE(3, 0x06);    // 1 signature + 2 sectors

  const SIGNATURE = 0xbeef;
  rec.writeUInt16LE(SIGNATURE, 0x30);
  rec.writeUInt16LE(0x1111, 0x32); // real bytes for sector 0
  rec.writeUInt16LE(0x2222, 0x34); // real bytes for sector 1

  // NTFS has stamped its signature over the last 2 bytes of each sector.
  rec.writeUInt16LE(SIGNATURE, 510);
  rec.writeUInt16LE(SIGNATURE, 1022);

  applyFixup(rec, 512);

  assert.equal(rec.readUInt16LE(510), 0x1111);
  assert.equal(rec.readUInt16LE(1022), 0x2222);
});

test("fixup: a torn record is detected, not silently accepted", () => {
  const rec = Buffer.alloc(1024);
  rec.write("FILE", 0, "latin1");
  rec.writeUInt16LE(0x30, 0x04);
  rec.writeUInt16LE(3, 0x06);
  rec.writeUInt16LE(0xbeef, 0x30);
  rec.writeUInt16LE(0xbeef, 510);
  rec.writeUInt16LE(0xdead, 1022); // wrong — a half-written record

  assert.throws(() => applyFixup(rec, 512), /fixup mismatch/);
});

// --- file records ----------------------------------------------------------

/** Build a minimal in-use record with $FILE_NAME and a resident $DATA. */
function makeRecord({ name, parent, isDirectory = false, size = 0 }) {
  const rec = Buffer.alloc(1024);
  rec.write("FILE", 0, "latin1");
  rec.writeUInt16LE(0, 0x04);
  rec.writeUInt16LE(0, 0x06);
  rec.writeUInt16LE(0x38, 0x14); // first attribute offset
  rec.writeUInt16LE(isDirectory ? 0x0003 : 0x0001, 0x16);

  let pos = 0x38;

  // $FILE_NAME
  const nameBytes = Buffer.from(name, "utf16le");
  const fnContent = 0x42 + nameBytes.length;
  const fnLength = align8(0x18 + fnContent);
  rec.writeUInt32LE(0x30, pos);
  rec.writeUInt32LE(fnLength, pos + 4);
  rec.writeUInt8(0, pos + 8);
  rec.writeUInt8(0, pos + 9);
  rec.writeUInt32LE(fnContent, pos + 0x10);
  rec.writeUInt16LE(0x18, pos + 0x14);
  rec.writeBigUInt64LE(BigInt(parent), pos + 0x18);
  rec.writeUInt8(name.length, pos + 0x18 + 0x40); // name length (characters)
  rec.writeUInt8(1, pos + 0x18 + 0x41);           // namespace: Win32
  nameBytes.copy(rec, pos + 0x18 + 0x42);
  pos += fnLength;

  // $DATA (resident)
  rec.writeUInt32LE(0x80, pos);
  rec.writeUInt32LE(0x20, pos + 4);
  rec.writeUInt8(0, pos + 8);
  rec.writeUInt8(0, pos + 9);
  rec.writeUInt32LE(size, pos + 0x10);
  rec.writeUInt16LE(0x18, pos + 0x14);
  pos += 0x20;

  rec.writeUInt32LE(0xffffffff, pos);
  return rec;
}

const align8 = (n) => (n + 7) & ~7;

test("file record: extracts name, parent and size", () => {
  const parsed = parseFileRecord(makeRecord({ name: "node_modules", parent: 5, isDirectory: true }), 42);
  assert.equal(parsed.name, "node_modules");
  assert.equal(parsed.parent, 5);
  assert.equal(parsed.recordNumber, 42);
  assert.equal(parsed.isDirectory, true);
});

test("file record: reads a long name in full", () => {
  // Guards the $FILE_NAME field order. Name length is at 0x40 and namespace
  // at 0x41; reading them the other way round truncates every name to the
  // namespace enum value (1-3 chars), which silently yields zero matches on
  // a real volume while short synthetic names still look fine.
  const long = "some-really-long-package-name-here";
  const parsed = parseFileRecord(makeRecord({ name: long, parent: 5, isDirectory: true }), 99);
  assert.equal(parsed.name, long);
  assert.equal(parsed.name.length, long.length);
});

test("file record: skips records not in use", () => {
  const rec = makeRecord({ name: "deleted", parent: 5 });
  rec.writeUInt16LE(0x0000, 0x16);
  assert.equal(parseFileRecord(rec, 1), null);
});

test("file record: ignores anything without a FILE signature", () => {
  assert.equal(parseFileRecord(Buffer.alloc(1024), 1), null);
});

test("file record: reads a resident $DATA size", () => {
  const parsed = parseFileRecord(makeRecord({ name: "small.txt", parent: 5, size: 1234 }), 7);
  assert.equal(parsed.size, 1234n);
});

// --- tree ------------------------------------------------------------------

// C:\Users\dustin\proj\node_modules\dep\node_modules
//
// Directories and file tallies are kept apart, mirroring the scanner: file
// records are folded into their parent's totals and dropped as they stream,
// so only directories are ever held.
function tree() {
  return indexRecords([
    { recordNumber: 5, parent: 5, name: ".", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 10, parent: 5, name: "Users", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 11, parent: 10, name: "dustin", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 12, parent: 11, name: "proj", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 13, parent: 12, name: "node_modules", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 14, parent: 13, name: "dep", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 15, parent: 14, name: "node_modules", isDirectory: true, size: 0n, mtime: null },
  ]);
}

// index.js (500 B) sits in record 15; big.bin (1000 B) in record 13.
const treeBytes = () => new Map([[15, 500n], [13, 1000n]]);
const treeFiles = () => new Map([[15, 1], [13, 1]]);

test("tree: resolves a record to a full path", () => {
  const byNumber = tree();
  assert.equal(
    resolvePath(byNumber, byNumber.get(15), "C:"),
    "C:\\Users\\dustin\\proj\\node_modules\\dep\\node_modules",
  );
});

test("tree: a broken parent chain resolves to null, not a bad path", () => {
  const byNumber = tree();
  byNumber.delete(11);
  assert.equal(resolvePath(byNumber, byNumber.get(13), "C:"), null);
});

test("tree: a cyclic chain terminates instead of hanging", () => {
  const byNumber = indexRecords([
    { recordNumber: 20, parent: 21, name: "a", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 21, parent: 20, name: "b", isDirectory: true, size: 0n, mtime: null },
  ]);
  assert.equal(resolvePath(byNumber, byNumber.get(20), "C:"), null);
});

test("tree: subtree size sums every descendant file", () => {
  const totals = subtreeSizes(tree(), treeBytes(), treeFiles(), [13]);
  assert.equal(totals.get(13).bytes, 1500n, "both the nested and direct file count");
  assert.equal(totals.get(13).files, 2);
});

test("tree: subtree size of a leaf counts only its own files", () => {
  const totals = subtreeSizes(tree(), treeBytes(), treeFiles(), [15]);
  assert.equal(totals.get(15).bytes, 500n);
  assert.equal(totals.get(15).files, 1);
});

test("tree: the root's self-parent link does not cause an infinite walk", () => {
  // Record 5 is its own parent on a real volume. An unguarded walk hangs.
  const totals = subtreeSizes(tree(), treeBytes(), treeFiles(), [5]);
  assert.equal(totals.get(5).bytes, 1500n, "totals the whole volume");
});

test("tree: a nested match is excluded so bytes are not double-counted", () => {
  const matches = findOutermostMatches(tree(), (n) => n === "node_modules");
  assert.equal(matches.length, 1, "the inner node_modules is covered by the outer one");
  assert.equal(matches[0].recordNumber, 13);
});

test("tree: sibling matches are both reported", () => {
  const byNumber = indexRecords([
    { recordNumber: 5, parent: 5, name: ".", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 30, parent: 5, name: "a", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 31, parent: 5, name: "b", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 32, parent: 30, name: "node_modules", isDirectory: true, size: 0n, mtime: null },
    { recordNumber: 33, parent: 31, name: "node_modules", isDirectory: true, size: 0n, mtime: null },
  ]);
  assert.equal(findOutermostMatches(byNumber, (n) => n === "node_modules").length, 2);
});
