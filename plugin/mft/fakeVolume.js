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
 *          attrs?: Buffer[], base?: number}} spec
 *   attrs are extra attributes placed after the name and data; base makes
 *   this an extension record of that base record
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
  if (mtime !== null) parts.push(standardInformation(mtime));
  if (name !== null) parts.push(fileName(name, parent));
  if (name !== null && !isDirectory) parts.push(resident(ATTR_DATA, sizedContent(size)));
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

function standardInformation(mtime) {
  const content = Buffer.alloc(0x30);
  content.writeBigUInt64LE(filetime(mtime), 8);
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
