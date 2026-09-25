/**
 * Tests for the change-journal parsers and readers. Every volume and
 * journal is a synthetic buffer.
 *
 *   node --test plugin/mft/journal.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parseMax, parseUsnRecords } from "./usn.js";
import { assembleAttribute, attributesOf, parseAttributeList, recordsHolding } from "./attrlist.js";
import { planReads, recordRanges, sliceRanges } from "./locate.js";
import { readEntries, readRawRecords } from "./reread.js";
import { findUsnAt, readChanges, readJournalInfo } from "./journal.js";
import { parseBootSector } from "./boot.js";
import { readTreeFrom } from "./scan.js";
import {
  CLUSTER,
  JOURNAL_PAGE,
  RECORD,
  buildVolume,
  installJournal,
  layOutJournal,
  nonResident,
  resident,
  usnRecord,
} from "./fakeVolume.js";

const BASE = {
  5: { name: ".", parent: 5, isDirectory: true, seq: 5 },
  11: { name: "$Extend", parent: 5, isDirectory: true },
  20: { name: "proj", parent: 5, isDirectory: true },
  21: { name: "a.txt", parent: 20, size: 10 },
};

// --- $Max and USN records -------------------------------------------------

test("usn: $Max gives size, delta, id and the lowest valid USN", () => {
  const buf = Buffer.alloc(32);
  buf.writeBigUInt64LE(33554432n, 0);
  buf.writeBigUInt64LE(8388608n, 8);
  buf.writeBigUInt64LE(0x01d9aabbccddeeffn, 16);
  buf.writeBigInt64LE(123456n, 24);
  assert.deepEqual(parseMax(buf), {
    maxSize: 33554432,
    allocationDelta: 8388608,
    id: 0x01d9aabbccddeeffn,
    lowestValidUsn: 123456,
  });
  assert.throws(() => parseMax(Buffer.alloc(8)), /too short/);
});

test("usn: v2 and v3 records read the same fields", () => {
  for (const version of [2, 3]) {
    const rec = usnRecord({
      version,
      frn: 70_000,
      seq: 9,
      parentFrn: 20,
      parentSeq: 3,
      usn: 4096,
      time: 1_700_000_000_123,
      reason: 0x100,
      name: "node_modules",
    });
    const { changes, rest } = parseUsnRecords(rec, 4096);
    assert.equal(rest, rec.length);
    assert.deepEqual(changes, [
      {
        frn: 70_000,
        seq: 9,
        parentFrn: 20,
        parentSeq: 3,
        usn: 4096,
        time: 1_700_000_000_123,
        reason: 0x100,
        name: "node_modules",
      },
    ]);
  }
});

test("usn: page padding and zero gaps are skipped", () => {
  const laid = layOutJournal(
    Array.from({ length: 80 }, (_, i) => ({ frn: 100 + i, name: `file-number-${i}` })),
    100 * 8,
  );
  assert.ok(laid.end > laid.start + JOURNAL_PAGE, "spans a page, so a page tail is padding");
  const { changes, hole } = parseUsnRecords(laid.bytes.subarray(800), 800);
  assert.equal(hole, null);
  assert.equal(changes.length, 80);
  assert.deepEqual(changes.map((c) => c.usn), laid.usns);
});

test("usn: a record cut off at the end is left for the next read", () => {
  const a = usnRecord({ frn: 1, usn: 0 });
  const b = usnRecord({ frn: 2, usn: a.length, name: "longer-name-here" });
  const both = Buffer.concat([a, b]);
  const cut = both.subarray(0, a.length + 20);
  const first = parseUsnRecords(cut, 0);
  assert.deepEqual(first.changes.map((c) => c.frn), [1]);
  assert.equal(first.rest, a.length);
  const next = parseUsnRecords(both.subarray(first.rest), first.rest);
  assert.deepEqual(next.changes.map((c) => c.frn), [2]);
});

test("usn: garbage, a wrong USN field and v4 records are not changes", () => {
  const good = usnRecord({ frn: 5, usn: 64 });
  const lying = usnRecord({ frn: 6, usn: 999_999 }); // USN does not match its offset
  const v4 = Buffer.from(usnRecord({ version: 3, frn: 7, usn: 0 }));
  const buf = Buffer.alloc(64 + good.length + lying.length + v4.length);
  buf.fill(0xab, 0, 64);
  good.copy(buf, 64);
  lying.copy(buf, 64 + good.length);
  const v4At = 64 + good.length + lying.length;
  v4.copy(buf, v4At);
  buf.writeUInt16LE(4, v4At + 4);
  buf.writeBigInt64LE(BigInt(v4At), v4At + 40);
  const { changes } = parseUsnRecords(buf, 0);
  assert.deepEqual(changes.map((c) => c.frn), [5]);
});

// --- attribute lists ---------------------------------------------------------

test("attrlist: entries name the record and VCN of each piece", () => {
  const volume = buildVolume({ records: BASE });
  installJournal(volume, { changes: [{ frn: 21 }] });
  const rec = volume.buf.subarray(4 * CLUSTER + 40 * RECORD, 4 * CLUSTER + 41 * RECORD);
  const listAttr = attributesOf(rec).find((a) => a.type === 0x20);
  const list = parseAttributeList(listAttr.content);
  assert.deepEqual(
    list.map((e) => [e.type, e.name, e.record, Number(e.lowestVcn)]),
    [
      [0x30, "", 40, 0],
      [0x80, "$Max", 40, 0],
      [0x80, "$J", 41, 0],
      [0x80, "$J", 42, 10],
    ],
  );
  assert.deepEqual(recordsHolding(list, 40, 0x80, "$J"), [41, 42]);
  assert.deepEqual(recordsHolding(list, 40, 0x80, "$Max"), []);
});

test("attrlist: pieces are stitched in VCN order, sparse runs kept", () => {
  const first = Buffer.alloc(RECORD);
  const second = Buffer.alloc(RECORD);
  const at = (rec, attr) => {
    rec.writeUInt16LE(0x38, 0x14);
    attr.copy(rec, 0x38);
    rec.writeUInt32LE(0xffffffff, 0x38 + attr.length);
  };
  at(second, nonResident(0x80, { name: "$J", lowestVcn: 5, runs: [{ lcn: 900, length: 2 }] }));
  at(first, nonResident(0x80, { name: "$J", runs: [{ lcn: null, length: 3 }, { lcn: 50, length: 2 }], dataSize: 7 * CLUSTER }));
  const j = assembleAttribute([second, first], 0x80, "$J");
  assert.equal(j.dataSize, BigInt(7 * CLUSTER));
  assert.deepEqual(
    j.runs.map((r) => [Number(r.vcn), r.lcn === null ? null : Number(r.lcn), Number(r.length)]),
    [
      [0, null, 3],
      [3, 50, 2],
      [5, 900, 2],
    ],
  );
  const rec = Buffer.alloc(RECORD);
  at(rec, resident(0x80, Buffer.from("hello"), "$Max"));
  assert.equal(assembleAttribute([rec], 0x80, "$Max").content.toString(), "hello");
  assert.equal(assembleAttribute([rec], 0x80, "$J"), null);
});

// --- locating ----------------------------------------------------------------

const RUNS = [
  { vcn: 0n, lcn: null, length: 2n },
  { vcn: 2n, lcn: 10n, length: 3n },
  { vcn: 5n, lcn: 40n, length: 1n },
];

test("locate: a stream slice maps through the runs, skipping holes", () => {
  assert.deepEqual(sliceRanges(RUNS, 4096, 4096, 5 * 4096 + 100), [
    { offset: 40960n, start: 8192, length: 3 * 4096 },
    { offset: 163840n, start: 20480, length: 100 },
  ]);
  assert.deepEqual(sliceRanges(RUNS, 4096, 0, 8192), []);
});

test("locate: a record's range, and none past the MFT's end", () => {
  const boot = { bytesPerCluster: 4096, bytesPerFileRecord: 1024 };
  const mft = [{ vcn: 0n, lcn: 4n, length: 2n }, { vcn: 2n, lcn: 100n, length: 1n }];
  assert.deepEqual(recordRanges(mft, boot, 9), [{ offset: 100n * 4096n + 1024n, start: 9216, length: 1024 }]);
  assert.deepEqual(recordRanges(mft, boot, 12), []);
});

test("locate: nearby pieces merge into one aligned read", () => {
  const plan = planReads(
    [
      { offset: 10240n, length: 1024, key: "b" },
      { offset: 4096n, length: 1024, key: "a" },
      { offset: 10_000_000n, length: 1024, key: "c" },
    ],
    { align: 4096 },
  );
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0], {
    offset: 4096n,
    length: 8192,
    parts: [
      { key: "a", at: 0, from: 0, length: 1024 },
      { key: "b", at: 0, from: 6144, length: 1024 },
    ],
  });
  assert.equal(plan[1].offset % 4096n, 0n);
});

// --- reading ---------------------------------------------------------------------

async function geometry(volume) {
  const boot = parseBootSector(await volume.read(0n, 512));
  const tree = await readTreeFrom(volume, "C:");
  return { boot, mftRuns: tree.mftRuns, tree };
}

test("reread: scattered records come back parsed, in few reads", async () => {
  const volume = buildVolume({ records: BASE });
  const { boot, mftRuns } = await geometry(volume);
  let reads = 0;
  const read = (o, l) => {
    reads += 1;
    return volume.read(o, l);
  };
  const { entries, torn } = await readEntries({ read, boot, mftRuns, numbers: [21, 20, 22, 999] });
  assert.equal(reads, 1, "one span covers them");
  assert.equal(entries.get(21).name, "a.txt");
  assert.equal(entries.get(20).isDirectory, true);
  assert.equal(entries.get(22), null, "a blank slot");
  assert.equal(entries.get(999), null, "past the MFT");
  assert.deepEqual(torn, []);
});

test("reread: a torn record is reported, not read as gone", async () => {
  const volume = buildVolume({ records: BASE });
  const { boot, mftRuns } = await geometry(volume);
  const at = 4 * CLUSTER + 21 * RECORD;
  volume.buf.writeUInt16LE(3, at + 0x06); // a fixup array ...
  volume.buf.writeUInt16LE(0xbeef, at + 0x30);
  volume.buf.writeUInt16LE(0xdead, at + 510); // ... that does not match
  const { records, torn } = await readRawRecords({ read: volume.read, boot, mftRuns, numbers: [21] });
  assert.deepEqual(torn, [21]);
  assert.equal(records.has(21), false);
});

test("journal: found through its attribute list, sparse front and all", async () => {
  const volume = buildVolume({ records: BASE });
  const { nextUsn } = installJournal(volume, {
    changes: [{ frn: 21 }, { frn: 20 }],
    firstUsn: 3 * JOURNAL_PAGE + 64,
    lowestValidUsn: 3 * JOURNAL_PAGE,
  });
  const { boot, mftRuns, tree } = await geometry(volume);
  assert.equal(tree.journalRecord, 40);
  const info = await readJournalInfo({ read: volume.read, boot, mftRuns, record: 40 });
  assert.equal(info.id, 77n);
  assert.equal(info.lowestValidUsn, 3 * JOURNAL_PAGE);
  assert.equal(info.nextUsn, nextUsn);
  assert.equal(info.runs[0].lcn, null, "the freed front is sparse");
});

test("journal: none at a blank or reused record", async () => {
  const volume = buildVolume({ records: BASE });
  const { boot, mftRuns } = await geometry(volume);
  assert.equal(await readJournalInfo({ read: volume.read, boot, mftRuns, record: 40 }), null);
  assert.equal(await readJournalInfo({ read: volume.read, boot, mftRuns, record: 21 }), null);
  assert.equal(await readJournalInfo({ read: volume.read, boot, mftRuns, record: null }), null);
});

test("journal: changes from a USN on, across both halves of $J", async () => {
  const volume = buildVolume({ records: BASE });
  const specs = Array.from({ length: 600 }, (_, i) => ({ frn: 1000 + i, name: `n${i}`, version: i % 2 ? 3 : 2 }));
  const { usns } = installJournal(volume, { changes: specs, clusters: 16 });
  assert.ok(usns[599] > 8 * CLUSTER + 2 * JOURNAL_PAGE, "the records reach the second half");
  const { boot, mftRuns } = await geometry(volume);
  const info = await readJournalInfo({ read: volume.read, boot, mftRuns, record: 40 });

  const all = await readChanges({ read: volume.read, boot, info, from: info.lowestValidUsn });
  assert.deepEqual(all.changes.map((c) => c.frn), specs.map((s) => s.frn));
  assert.equal(all.end, info.nextUsn);

  const later = await readChanges({ read: volume.read, boot, info, from: usns[300] });
  assert.deepEqual(later.changes.map((c) => c.frn), specs.slice(300).map((s) => s.frn));
  assert.deepEqual(await readChanges({ read: volume.read, boot, info, from: info.nextUsn }), {
    changes: [],
    end: info.nextUsn,
  });
});

test("journal: an unflushed zero page stops the read at its start", async () => {
  const volume = buildVolume({ records: BASE });
  const specs = Array.from({ length: 600 }, (_, i) => ({ frn: 1000 + i, time: 1_000_000 + i * 1000 }));
  const { usns } = installJournal(volume, { changes: specs });
  const { boot, mftRuns } = await geometry(volume);
  const info = await readJournalInfo({ read: volume.read, boot, mftRuns, record: 40 });

  // The fourth page of data (cluster 103 holds stream VCN 5): not yet flushed.
  volume.buf.fill(0, 103 * CLUSTER, 104 * CLUSTER);
  const hole = 5 * JOURNAL_PAGE;
  const { changes, end } = await readChanges({ read: volume.read, boot, info, from: usns[0] });
  assert.equal(end, hole, "the next read starts at the unflushed page");
  assert.deepEqual(
    changes.map((c) => c.frn),
    specs.filter((_, i) => usns[i] < hole).map((s) => s.frn),
    "nothing past the hole is taken",
  );
});

test("journal: findUsnAt lands at or before the first change after a time", async () => {
  const volume = buildVolume({ records: BASE });
  const specs = Array.from({ length: 600 }, (_, i) => ({ frn: 1000 + i, time: 1_000_000 + i * 1000 }));
  const { usns } = installJournal(volume, { changes: specs });
  const { boot, mftRuns } = await geometry(volume);
  const info = await readJournalInfo({ read: volume.read, boot, mftRuns, record: 40 });

  for (const i of [0, 1, 250, 599]) {
    const usn = await findUsnAt({ read: volume.read, boot, info, time: specs[i].time });
    assert.ok(usn <= usns[i], `at or before change ${i}`);
    assert.ok(usns[i] - usn < 2 * JOURNAL_PAGE, `within two pages of change ${i}`);
  }
  const after = await findUsnAt({ read: volume.read, boot, info, time: 9e12 });
  assert.ok(after >= usns[599] - JOURNAL_PAGE && after <= usns[599]);
});
