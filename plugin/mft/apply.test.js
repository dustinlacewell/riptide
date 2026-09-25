/**
 * Tests for bringing a tree up to date from journal changes.
 *
 * The property: folding tree A, then applying the records a run of random
 * changes touched, gives the same tree as folding the final records from
 * scratch — folders, own bytes, own files, own latest, mark counts, rows.
 *
 *   node --test plugin/mft/apply.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parseFileRecord } from "./record.js";
import { buildNameQuery } from "./filenames.js";
import { addRecord, createTree } from "./fold.js";
import { LAG_MS, applyChanges, changedRecords, staleReason, unflushedRecords } from "./apply.js";
import { buildRecord } from "./fakeVolume.js";
import { dumpTree } from "./treeDump.js";
import { createWorld, random } from "./world.js";

const RECORDS = 64;
const QUERY = buildNameQuery(["cargo.toml", "package.json", "*.csproj"]);

function entryOf(spec, n) {
  return parseFileRecord(buildRecord(spec), n);
}

function fold(specs) {
  return foldWith((n) => specs.get(n));
}

/** Fold record n as specOf(n) has it, for every record number. */
function foldWith(specOf) {
  const tree = createTree({ size: RECORDS, query: QUERY });
  for (let n = 0; n < RECORDS; n++) {
    const spec = specOf(n);
    const entry = spec ? entryOf(spec, n) : null;
    if (entry) addRecord(tree, n, entry);
  }
  return tree;
}

/** Every changed record, as the MFT now holds it. */
function reread(specs, numbers) {
  const entries = new Map();
  for (const n of numbers) entries.set(n, specs.has(n) ? entryOf(specs.get(n), n) : null);
  return entries;
}

test("apply: a run of random changes lands where a fresh fold does", () => {
  let moved = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const world = createWorld(seed, { records: RECORDS });
    for (let i = 0; i < 30; i++) world.step();
    const tree = fold(world.specs);

    const changes = [];
    const steps = 1 + (seed % 40);
    for (let i = 0; i < steps; i++) changes.push(...world.step());

    const want = dumpTree(fold(world.specs), RECORDS);
    try {
      assert.deepEqual(dumpTree(tree, RECORDS), want);
    } catch {
      moved += 1; // the changes did change something
    }
    const { numbers } = changedRecords(changes, { now: world.now() + LAG_MS });
    applyChanges(tree, numbers, reread(world.specs, numbers));
    assert.deepEqual(dumpTree(tree, RECORDS), want, `seed ${seed}`);
  }
  assert.ok(moved >= 70, `most runs change the tree (${moved} of 80)`);
});

test("apply: order, a full read taken over time, and a late partial update all converge", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const world = createWorld(seed, { records: RECORDS, first: 20 });
    const rnd = random(seed * 7);
    for (let i = 0; i < 25; i++) world.step();
    const steps = 5 + (seed % 60);
    const snaps = [new Map(world.specs)];
    const changes = [];
    for (let i = 0; i < steps; i++) {
      changes.push(...world.step());
      snaps.push(new Map(world.specs));
    }
    const want = dumpTree(fold(world.specs), RECORDS);
    const { numbers } = changedRecords(changes, { now: world.now() + LAG_MS });
    const entries = reread(world.specs, numbers);

    // A full read streams for a while: record n is seen at a later state
    // the higher n is.
    const mixed = foldWith((n) => snaps[Math.floor((n / RECORDS) * snaps.length)].get(n));
    applyChanges(mixed, numbers, entries);
    assert.deepEqual(dumpTree(mixed, RECORDS), want, `mixed, seed ${seed}`);

    const shuffled = fold(snaps[0]);
    applyChanges(shuffled, [...numbers].sort(() => rnd() - 0.5), entries);
    assert.deepEqual(dumpTree(shuffled, RECORDS), want, `shuffled, seed ${seed}`);

    // Half the changes first, read at a middle state, then all of them.
    const split = fold(snaps[0]);
    const half = changedRecords(changes.slice(0, Math.floor(changes.length / 2)), {
      now: world.now() + LAG_MS,
    }).numbers;
    applyChanges(split, half, reread(snaps[Math.floor(steps / 2)], half));
    applyChanges(split, numbers, entries);
    assert.deepEqual(dumpTree(split, RECORDS), want, `split, seed ${seed}`);
  }
});

test("apply: applying the same changes again changes nothing", () => {
  for (let seed = 100; seed <= 120; seed++) {
    const world = createWorld(seed, { records: RECORDS });
    for (let i = 0; i < 30; i++) world.step();
    const tree = fold(world.specs);
    const changes = [];
    for (let i = 0; i < 15; i++) changes.push(...world.step());

    const { numbers } = changedRecords(changes, { now: world.now() + LAG_MS });
    const entries = reread(world.specs, numbers);
    applyChanges(tree, numbers, entries);
    const once = dumpTree(tree, RECORDS);
    applyChanges(tree, numbers, entries);
    assert.deepEqual(dumpTree(tree, RECORDS), once, `seed ${seed}`);
  }
});

test("apply: parents are read again, and recent changes are carried", () => {
  const changes = [
    { frn: 60, parentFrn: 20, time: 1_000 },
    { frn: 61, parentFrn: 21, time: 15_000 },
  ];
  const { numbers, recent } = changedRecords(changes, { recent: [7], now: 20_000 });
  assert.deepEqual([...numbers].sort((a, b) => a - b), [7, 20, 21, 60, 61]);
  assert.deepEqual(recent.sort((a, b) => a - b), [21, 61], "only what changed under LAG_MS ago");
});

test("apply: a record whose own USN trails the journal is unflushed", () => {
  const changes = [
    { frn: 50, usn: 100 },
    { frn: 50, usn: 300 },
    { frn: 51, usn: 200 },
    { frn: 52, usn: 250 },
    { frn: 53, usn: 260 },
  ];
  const entries = new Map([
    [50, { usn: 120 }], // behind its newest record, 300
    [51, { usn: 200 }],
    [52, { usn: null }], // no USN to compare: trusted
    [53, null], // gone: nothing left to be stale
  ]);
  assert.deepEqual(unflushedRecords(changes, entries), [50]);
});

test("record: $STANDARD_INFORMATION's USN is read when present", () => {
  assert.equal(entryOf({ name: "a", parent: 5, usn: 123456 }, 50).usn, 123456);
  assert.equal(entryOf({ name: "a", parent: 5, mtime: 5_000 }, 50).usn, null);
});

test("apply: a torn record keeps what the tree had", () => {
  const specs = new Map([
    [5, { name: ".", parent: 5, isDirectory: true }],
    [50, { name: "a.txt", parent: 5, size: 40 }],
  ]);
  const tree = fold(specs);
  const { stats } = applyChanges(tree, [50], new Map());
  assert.equal(stats.records, 0);
  assert.equal(tree.ownBytes.get(5), 40n);
});

test("apply: a removed newest file gives its folder the next newest time", () => {
  const specs = new Map([
    [5, { name: ".", parent: 5, isDirectory: true }],
    [50, { name: "old.txt", parent: 5, mtime: 1_000_000 }],
    [51, { name: "new.txt", parent: 5, mtime: 9_000_000 }],
  ]);
  const tree = fold(specs);
  assert.equal(tree.ownLatest.get(5), 9_000_000);
  const { dirtyDirs } = applyChanges(tree, [51], new Map([[51, null]]));
  assert.equal(tree.ownLatest.get(5), 1_000_000);
  assert.deepEqual([...dirtyDirs], [5]);
});

test("apply: staleReason names each case where only a full read will do", () => {
  const held = { boot: { serial: 1n }, journal: { id: 9n, nextUsn: 5000 } };
  const info = { id: 9n, lowestValidUsn: 0, nextUsn: 8000 };
  assert.equal(staleReason(held, { serial: 1n, info }), null);
  assert.match(staleReason(held, { serial: 2n, info }), /volume changed/);
  assert.match(staleReason({ ...held, journal: null }, { serial: 1n, info }), /no change journal/);
  assert.match(staleReason(held, { serial: 1n, info: null }), /gone/);
  assert.match(staleReason(held, { serial: 1n, info: { ...info, id: 10n } }), /replaced/);
  assert.match(staleReason(held, { serial: 1n, info: { ...info, lowestValidUsn: 6000 } }), /wrapped/);
  assert.match(staleReason(held, { serial: 1n, info: { ...info, nextUsn: 4000 } }), /backwards/);
});
