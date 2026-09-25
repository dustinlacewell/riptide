/**
 * Tests for the NTFS log witness: the restart-page parser, and the full
 * read it forces when the volume was written without the journal.
 *
 *   node --test plugin/mft/logfile.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parseBootSector } from "./boot.js";
import { parseRestartPage, readLogLsn } from "./logfile.js";
import { foreignWriteReason, staleReason } from "./apply.js";
import { readMftRuns } from "./scan.js";
import { createTreeCache } from "./treeCache.js";
import { CLUSTER, buildVolume, installJournal, installLogFile } from "./fakeVolume.js";

const RECORDS = {
  5: { name: ".", parent: 5, isDirectory: true },
  11: { name: "$Extend", parent: 5, isDirectory: true },
  50: { name: "a.txt", parent: 5, size: 10 },
};

async function lsnOf(volume) {
  const boot = parseBootSector(await volume.read(0n, 512));
  return readLogLsn({ read: volume.read, boot, mftRuns: await readMftRuns(volume.read, boot) });
}

test("logfile: the newer restart page's current LSN is read through its fix-ups", async () => {
  const volume = buildVolume({ records: RECORDS });
  installLogFile(volume, { lsn: 0x1234_5678_9an });
  assert.equal(await lsnOf(volume), 0x1234_5678_9an);
});

test("logfile: a wiped, torn or missing log has no LSN", async () => {
  const volume = buildVolume({ records: RECORDS });
  assert.equal(await lsnOf(volume), null, "no $LogFile record");
  installLogFile(volume, { lsn: null });
  assert.equal(await lsnOf(volume), null, "0xFF, as ntfs-3g leaves it");

  installLogFile(volume, { lsn: 500n });
  const page = Buffer.from(volume.buf.subarray(200 * CLUSTER, 201 * CLUSTER));
  page.writeUInt16LE(0xdead, 510);
  assert.equal(parseRestartPage(page, 512), null, "a torn page");
  assert.equal(parseRestartPage(Buffer.alloc(CLUSTER), 512), null, "not RSTR");
});

test("logfile: the LSN going backwards, or the log reset, needs a full read", () => {
  const held = { boot: { serial: 1n }, journal: { id: 9n, nextUsn: 10 }, lsn: 1000n };
  const info = { id: 9n, lowestValidUsn: 0, nextUsn: 20 };
  assert.equal(staleReason(held, { serial: 1n, info, lsn: 1000n }), null);
  assert.equal(staleReason(held, { serial: 1n, info, lsn: 2000n }), null);
  assert.match(staleReason(held, { serial: 1n, info, lsn: 999n }), /backwards/);
  assert.match(staleReason(held, { serial: 1n, info, lsn: null }), /reset/);
  assert.equal(staleReason({ ...held, lsn: null }, { serial: 1n, info, lsn: null }), null, "no log to watch");
});

test("logfile: the log moving with no journal records is a foreign write", () => {
  const held = { lsn: 1000n };
  assert.match(foreignWriteReason(held, { lsn: 1500n, changes: 0 }), /no journal records/);
  assert.equal(foreignWriteReason(held, { lsn: 1500n, changes: 3 }), null);
  assert.equal(foreignWriteReason(held, { lsn: 1000n, changes: 0 }), null);
  assert.equal(foreignWriteReason({ lsn: null }, { lsn: 1500n, changes: 0 }), null);
});

test("cache: a write another OS made, with no journal record, forces a full read", async () => {
  const volume = buildVolume({ records: RECORDS });
  installJournal(volume, { changes: [] });
  installLogFile(volume, { lsn: 1000n });
  const cache = createTreeCache({
    open: async () => ({ read: volume.read, close: async () => {} }),
    wallClock: () => 9e12,
  });
  const first = await cache.get("C:");
  assert.equal(first.tree.lsn, 1000n);
  assert.equal((await cache.get("C:")).how, "delta", "nothing moved");

  // ntfs-3g grew a.txt; Windows remounted and moved the log on.
  volume.write(50, { name: "a.txt", parent: 5, size: 300 });
  installLogFile(volume, { lsn: 1800n });
  const got = await cache.get("C:");
  assert.equal(got.how, "full");
  assert.match(got.reason, /no journal records/);
  assert.equal(got.tree.lsn, 1800n);
  assert.equal(got.tree.ownBytes.get(5) - first.tree.ownBytes.get(5), 290n);
});

test("cache: the log moving along with journal records is an ordinary update", async () => {
  const volume = buildVolume({ records: RECORDS });
  installJournal(volume, { changes: [] });
  installLogFile(volume, { lsn: 1000n });
  const cache = createTreeCache({
    open: async () => ({ read: volume.read, close: async () => {} }),
    wallClock: () => 9e12,
  });
  await cache.get("C:");
  volume.write(50, { name: "a.txt", parent: 5, size: 300 });
  installJournal(volume, { changes: [{ frn: 50, parentFrn: 5 }] });
  installLogFile(volume, { lsn: 1800n });
  const got = await cache.get("C:");
  assert.equal(got.how, "delta");
  assert.equal(got.tree.lsn, 1800n);
});
