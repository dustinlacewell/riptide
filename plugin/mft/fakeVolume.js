/**
 * Test helper: a synthetic NTFS volume in one buffer.
 *
 * Geometry is fixed: 512-byte sectors, 4096-byte clusters, 1024-byte
 * records. The boot sector sits at 0 and the MFT at cluster MFT_CLUSTER;
 * record 0 carries the MFT's own run list. Nothing here touches a disk.
 *
 *   buildVolume({records, count, clusters})   -> {buf, read, ...}
 *   buildRecord(spec)                          -> one 1 KB record
 *   resident / nonResident / encodeRuns       attribute builders
 */

export const SECTOR = 512;
export const CLUSTER = 4096;
export const RECORD = 1024;
export const MFT_CLUSTER = 4;
export const SERIAL = 0x1234_5678_9abc_def0n;

const ATTR_SI = 0x10;
const ATTR_FILE_NAME = 0x30;
const ATTR_DATA = 0x80;
const FIRST_ATTR = 0x38;

/**
 * @param {{records: Record<number, object>, count?: number, clusters?: number,
 *          serial?: bigint}} spec
 *   records by number, each a buildRecord spec or a ready Buffer; count is
 *   the MFT's record count; clusters the volume size
 */
export function buildVolume({ records, count = 64, clusters = 256, serial = SERIAL }) {
  const buf = Buffer.alloc(clusters * CLUSTER);
  bootSector(serial).copy(buf, 0);

  const mftClusters = Math.ceil((count * RECORD) / CLUSTER);
  const zero = records[0] ?? {
    name: "$MFT",
    parent: 5,
    attrs: [nonResident(ATTR_DATA, { runs: [{ lcn: MFT_CLUSTER, length: mftClusters }], dataSize: count * RECORD })],
  };
  const all = { ...records, 0: zero };
  for (const [n, spec] of Object.entries(all)) writeRecord(buf, Number(n), spec);

  return {
    buf,
    count,
    read: async (offset, length) => buf.subarray(Number(offset), Number(offset) + length),
    write: (n, spec) => writeRecord(buf, n, spec),
  };
}

/** Put a record into a volume buffer's MFT. */
export function writeRecord(buf, n, spec) {
  const rec = Buffer.isBuffer(spec) ? spec : buildRecord(spec);
  rec.copy(buf, MFT_CLUSTER * CLUSTER + n * RECORD);
}

/** A blank, unused record slot. */
export const BLANK = Buffer.alloc(RECORD);

/**
 * @param {{name?: string, parent?: number, isDirectory?: boolean, size?: number,
 *          mtime?: number|null, seq?: number, inUse?: boolean,
 *          attrs?: Buffer[], base?: number, noData?: boolean,
 *          usn?: number|null}} spec
 *   usn gives $STANDARD_INFORMATION its 3.x form carrying that USN;
 *   attrs are extra attributes placed after the name and data; base makes
 *   this an extension record of that base record; noData leaves out the
 *   unnamed $DATA a file otherwise gets
 */
export function buildRecord({
  name = null,
  parent = 5,
  isDirectory = false,
  size = 0,
  mtime = null,
  seq = 1,
  inUse = true,
  attrs = [],
  base = 0,
  noData = false,
  usn = null,
}) {
  const rec = Buffer.alloc(RECORD);
  rec.write("FILE", 0, "latin1");
  rec.writeUInt16LE(0x30, 0x04);
  rec.writeUInt16LE(0, 0x06); // no fixup array
  rec.writeUInt16LE(seq, 0x10);
  rec.writeUInt16LE(FIRST_ATTR, 0x14);
  rec.writeUInt16LE((inUse ? 1 : 0) | (isDirectory ? 2 : 0), 0x16);
  rec.writeBigUInt64LE(BigInt(base), 0x20);

  const parts = [];
  if (mtime !== null || usn !== null) parts.push(standardInformation(mtime, usn));
  if (name !== null) parts.push(fileName(name, parent));
  if (name !== null && !isDirectory && !noData) parts.push(resident(ATTR_DATA, sizedContent(size)));
  parts.push(...attrs);

  let pos = FIRST_ATTR;
  for (const part of parts) {
    part.copy(rec, pos);
    pos += part.length;
  }
  rec.writeUInt32LE(0xffffffff, pos);
  rec.writeUInt32LE(pos + 8, 0x18);
  return rec;
}

/**
 * A resident attribute. A resident $DATA holds its bytes in the record,
 * so a test file's size is its content length; sizedContent fakes that.
 */
export function resident(type, content, name = "") {
  const nameBytes = Buffer.from(name, "utf16le");
  const contentOffset = align8(0x18 + nameBytes.length);
  const length = align8(contentOffset + content.length);
  const attr = Buffer.alloc(length);
  attr.writeUInt32LE(type, 0);
  attr.writeUInt32LE(length, 4);
  attr.writeUInt8(0, 8);
  attr.writeUInt8(name.length, 9);
  attr.writeUInt16LE(0x18, 10);
  attr.writeUInt32LE(content.length, 0x10);
  attr.writeUInt16LE(contentOffset, 0x14);
  nameBytes.copy(attr, 0x18);
  content.copy(attr, contentOffset);
  return attr;
}

/**
 * A non-resident attribute.
 *
 * @param {number} type
 * @param {{runs: Array<{lcn: number|null, length: number}>, name?: string,
 *          lowestVcn?: number, dataSize?: number}} spec
 */
export function nonResident(type, { runs, name = "", lowestVcn = 0, dataSize = 0 }) {
  const nameBytes = Buffer.from(name, "utf16le");
  const runBytes = encodeRuns(runs);
  const runOffset = align8(0x40 + nameBytes.length);
  const length = align8(runOffset + runBytes.length + 1);
  const clusters = runs.reduce((sum, r) => sum + r.length, 0);
  const attr = Buffer.alloc(length);
  attr.writeUInt32LE(type, 0);
  attr.writeUInt32LE(length, 4);
  attr.writeUInt8(1, 8);
  attr.writeUInt8(name.length, 9);
  attr.writeUInt16LE(0x40, 10);
  attr.writeBigUInt64LE(BigInt(lowestVcn), 0x10);
  attr.writeBigUInt64LE(BigInt(lowestVcn + clusters - 1), 0x18);
  attr.writeUInt16LE(runOffset, 0x20);
  attr.writeBigUInt64LE(BigInt(clusters * CLUSTER), 0x28);
  attr.writeBigUInt64LE(BigInt(dataSize), 0x30);
  attr.writeBigUInt64LE(BigInt(dataSize), 0x38);
  nameBytes.copy(attr, 0x40);
  runBytes.copy(attr, runOffset);
  return attr;
}

/**
 * Encode a run list. A null lcn is a sparse run. Each run takes 4 length
 * bytes and 4 offset bytes: wasteful, and valid.
 *
 * @param {Array<{lcn: number|null, length: number}>} runs
 */
export function encodeRuns(runs) {
  const out = [];
  let previous = 0;
  for (const { lcn, length } of runs) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(length);
    if (lcn === null) {
      out.push(Buffer.from([0x04]), len);
      continue;
    }
    const delta = Buffer.alloc(4);
    delta.writeInt32LE(lcn - previous);
    previous = lcn;
    out.push(Buffer.from([0x44]), len, delta);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

export const align8 = (n) => (n + 7) & ~7;

// ---------------------------------------------------------------------------
// The change journal

export const JOURNAL_PAGE = 4096;

/**
 * One USN record.
 *
 * @param {{version?: 2|3, frn: number, seq?: number, parentFrn?: number,
 *          parentSeq?: number, usn: number, time?: number, reason?: number,
 *          name?: string}} spec
 */
export function usnRecord({
  version = 2,
  frn,
  seq = 1,
  parentFrn = 5,
  parentSeq = 5,
  usn,
  time = 1_700_000_000_000,
  reason = 0x80000000,
  name = "f",
}) {
  const refWidth = version === 2 ? 8 : 16;
  const at = 8 + refWidth * 2;
  const nameBytes = Buffer.from(name, "utf16le");
  const nameOffset = at + 36;
  const length = align8(nameOffset + nameBytes.length);
  const rec = Buffer.alloc(length);
  rec.writeUInt32LE(length, 0);
  rec.writeUInt16LE(version, 4);
  rec.writeBigUInt64LE(reference(frn, seq), 8);
  rec.writeBigUInt64LE(reference(parentFrn, parentSeq), 8 + refWidth);
  rec.writeBigInt64LE(BigInt(usn), at);
  rec.writeBigUInt64LE(filetime(time), at + 8);
  rec.writeUInt32LE(reason, at + 16);
  rec.writeUInt16LE(nameBytes.length, at + 32);
  rec.writeUInt16LE(nameOffset, at + 34);
  nameBytes.copy(rec, nameOffset);
  return rec;
}

/**
 * Lay records out as $J does: from firstUsn on, never across a page, the
 * rest of a page left zero.
 *
 * @param {object[]} specs usnRecord specs without usn
 * @param {number} firstUsn
 * @returns {{bytes: Buffer, start: number, end: number, usns: number[]}}
 *   bytes covers [start, end); start is firstUsn's page
 */
export function layOutJournal(specs, firstUsn) {
  const start = firstUsn - (firstUsn % JOURNAL_PAGE);
  const parts = [];
  const usns = [];
  let pos = firstUsn;
  for (const spec of specs) {
    let rec = usnRecord({ ...spec, usn: pos });
    const left = JOURNAL_PAGE - (pos % JOURNAL_PAGE);
    if (rec.length > left) {
      pos += left;
      rec = usnRecord({ ...spec, usn: pos });
    }
    parts.push({ at: pos - start, rec });
    usns.push(pos);
    pos += rec.length;
  }
  const bytes = Buffer.alloc(pos - start);
  for (const { at, rec } of parts) rec.copy(bytes, at);
  return { bytes, start, end: pos, usns };
}

/**
 * Give a volume a change journal: $UsnJrnl in record `record` under
 * $Extend, its $ATTRIBUTE_LIST sending $J to two extension records (so the
 * stream's runs must be stitched), $J sparse below its first page.
 *
 * Call again with a longer list to append: USNs of the earlier records do
 * not move.
 *
 * @param {ReturnType<typeof buildVolume>} volume
 * @param {{changes: object[], record?: number, extensions?: [number, number],
 *          firstUsn?: number, id?: bigint, lowestValidUsn?: number,
 *          lcn?: number, clusters?: number, version?: 2|3}} spec
 *   the journal's data sits at clusters [lcn, lcn + clusters), split in two
 *   halves that are not adjacent on the volume
 * @returns {{nextUsn: number, usns: number[]}}
 */
export function installJournal(
  volume,
  {
    changes,
    record = 40,
    extensions = [41, 42],
    firstUsn = 2 * JOURNAL_PAGE,
    id = 77n,
    lowestValidUsn = firstUsn,
    lcn = 100,
    clusters = 16,
  },
) {
  const laid = layOutJournal(changes, firstUsn);
  const sparse = laid.start / CLUSTER;
  const half = clusters / 2;
  const secondLcn = lcn + half + 4; // a gap: the halves are not adjacent
  const capacity = clusters * CLUSTER;
  if (laid.bytes.length > capacity) throw new Error("fake journal too small for its records");

  // Stream bytes [start, start + half) at lcn; the rest at secondLcn.
  const firstHalf = laid.bytes.subarray(0, half * CLUSTER);
  const secondHalf = laid.bytes.subarray(half * CLUSTER);
  volume.buf.fill(0, lcn * CLUSTER, (lcn + half) * CLUSTER);
  volume.buf.fill(0, secondLcn * CLUSTER, (secondLcn + half) * CLUSTER);
  firstHalf.copy(volume.buf, lcn * CLUSTER);
  secondHalf.copy(volume.buf, secondLcn * CLUSTER);

  const max = Buffer.alloc(32);
  max.writeBigUInt64LE(32n * 1024n * 1024n, 0);
  max.writeBigUInt64LE(8n * 1024n * 1024n, 8);
  max.writeBigUInt64LE(id, 16);
  max.writeBigInt64LE(BigInt(lowestValidUsn), 24);

  const list = Buffer.concat([
    listEntry({ type: 0x30, record }),
    listEntry({ type: ATTR_DATA, name: "$Max", record }),
    listEntry({ type: ATTR_DATA, name: "$J", record: extensions[0], lowestVcn: 0 }),
    listEntry({ type: ATTR_DATA, name: "$J", record: extensions[1], lowestVcn: sparse + half }),
  ]);

  volume.write(record, {
    name: "$UsnJrnl",
    parent: 11,
    attrs: [resident(0x20, list), resident(ATTR_DATA, max, "$Max")],
    noData: true,
  });
  volume.write(extensions[0], {
    base: record,
    attrs: [
      nonResident(ATTR_DATA, {
        name: "$J",
        runs: [{ lcn: null, length: sparse }, { lcn, length: half }].filter((r) => r.length > 0),
        dataSize: laid.end,
      }),
    ],
  });
  volume.write(extensions[1], {
    base: record,
    attrs: [nonResident(ATTR_DATA, { name: "$J", lowestVcn: sparse + half, runs: [{ lcn: secondLcn, length: half }] })],
  });
  return { nextUsn: laid.end, usns: laid.usns };
}

/**
 * Give a volume a $LogFile (record 2) whose two restart pages say
 * `lsn`, or hold 0xFF as ntfs-3g leaves a log it reset.
 *
 * @param {ReturnType<typeof buildVolume>} volume
 * @param {{lsn: bigint|null, lcn?: number}} spec lsn null wipes the pages
 */
export function installLogFile(volume, { lsn, lcn = 200 }) {
  volume.write(2, {
    name: "$LogFile",
    parent: 5,
    noData: true,
    attrs: [nonResident(ATTR_DATA, { runs: [{ lcn, length: 2 }], dataSize: 2 * CLUSTER })],
  });
  for (const page of [0, 1]) {
    const at = (lcn + page) * CLUSTER;
    if (lsn === null) volume.buf.fill(0xff, at, at + CLUSTER);
    else restartPage(lsn - BigInt(page)).copy(volume.buf, at);
  }
}

// A restart page with its fix-up array applied the way NTFS writes it.
function restartPage(lsn) {
  const page = Buffer.alloc(CLUSTER);
  const sectors = CLUSTER / SECTOR;
  page.write("RSTR", 0, "latin1");
  page.writeUInt16LE(0x1e, 0x04);
  page.writeUInt16LE(sectors + 1, 0x06);
  page.writeUInt32LE(CLUSTER, 0x10);
  page.writeUInt32LE(CLUSTER, 0x14);
  page.writeUInt16LE(0x30, 0x18);
  page.writeInt16LE(1, 0x1c);
  page.writeBigInt64LE(lsn, 0x30);
  const signature = 0x0007;
  page.writeUInt16LE(signature, 0x1e);
  for (let i = 1; i <= sectors; i++) {
    const end = i * SECTOR - 2;
    page.writeUInt16LE(page.readUInt16LE(end), 0x1e + i * 2);
    page.writeUInt16LE(signature, end);
  }
  return page;
}

function listEntry({ type, name = "", record, lowestVcn = 0, seq = 1 }) {
  const nameBytes = Buffer.from(name, "utf16le");
  const length = align8(0x1a + nameBytes.length);
  const entry = Buffer.alloc(length);
  entry.writeUInt32LE(type, 0);
  entry.writeUInt16LE(length, 4);
  entry.writeUInt8(name.length, 6);
  entry.writeUInt8(0x1a, 7);
  entry.writeBigUInt64LE(BigInt(lowestVcn), 8);
  entry.writeBigUInt64LE(reference(record, seq), 0x10);
  nameBytes.copy(entry, 0x1a);
  return entry;
}

function reference(n, seq) {
  return (BigInt(seq) << 48n) | BigInt(n);
}

/** Unix ms as a FILETIME. */
export function filetime(ms) {
  return (BigInt(ms) + 11644473600000n) * 10000n;
}

// ---------------------------------------------------------------------------

function bootSector(serial) {
  const buf = Buffer.alloc(SECTOR);
  buf.write("NTFS    ", 3, "latin1");
  buf.writeUInt16LE(SECTOR, 0x0b);
  buf.writeUInt8(CLUSTER / SECTOR, 0x0d);
  buf.writeBigUInt64LE(BigInt(MFT_CLUSTER), 0x30);
  buf.writeInt8(-10, 0x40);
  buf.writeBigUInt64LE(serial, 0x48);
  return buf;
}

// The short (NTFS 1.2) form without a USN, or the 3.x form with one.
function standardInformation(mtime, usn) {
  const content = Buffer.alloc(usn === null ? 0x30 : 0x48);
  if (mtime !== null) content.writeBigUInt64LE(filetime(mtime), 8);
  if (usn !== null) content.writeBigUInt64LE(BigInt(usn), 0x40);
  return resident(ATTR_SI, content);
}

function fileName(name, parent) {
  const nameBytes = Buffer.from(name, "utf16le");
  const content = Buffer.alloc(0x42 + nameBytes.length);
  content.writeBigUInt64LE(BigInt(parent), 0);
  content.writeUInt8(name.length, 0x40);
  content.writeUInt8(1, 0x41); // Win32 namespace
  nameBytes.copy(content, 0x42);
  return resident(ATTR_FILE_NAME, content);
}

// A resident $DATA whose length is the size; kept under the record size.
function sizedContent(size) {
  if (size > 512) throw new Error("fake resident files hold at most 512 bytes");
  return Buffer.alloc(size);
}
