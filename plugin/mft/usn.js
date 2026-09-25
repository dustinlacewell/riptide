/**
 * The NTFS change journal's on-disk formats.
 *
 * $Extend\$UsnJrnl has two streams:
 *
 *   $Max  32 bytes: MaximumSize, AllocationDelta, UsnJournalID,
 *         LowestValidUsn
 *   $J    the records, back to back. A record's USN is its byte offset in
 *         $J. The stream is sparse: the front is freed as the journal
 *         wraps, and each page's unused tail is zero.
 *
 * A record names a file by its reference (record number + sequence number)
 * and its parent's, with a reason mask, a time and the file's name.
 * Versions 2 and 3 differ only in the width of the references (64 and 128
 * bits); for NTFS the upper 64 bits of a v3 reference are zero.
 *
 * The parser checks each record's own USN field against its offset, so a
 * zero gap, padding or a half record at a read boundary is skipped rather
 * than misread.
 *
 * Pure.
 */

import { filetimeToMs } from "./record.js";

const MIN_RECORD = 0x3c;
const ALIGN = 8;

/**
 * @param {Buffer} buf at least 32 bytes of $Max
 * @returns {{maxSize: number, allocationDelta: number, id: bigint, lowestValidUsn: number}}
 */
export function parseMax(buf) {
  if (buf.length < 32) throw new Error(`$Max too short: ${buf.length} bytes`);
  return {
    maxSize: Number(buf.readBigUInt64LE(0)),
    allocationDelta: Number(buf.readBigUInt64LE(8)),
    id: buf.readBigUInt64LE(16),
    lowestValidUsn: Number(buf.readBigInt64LE(24)),
  };
}

/**
 * @typedef {{frn: number, seq: number, parentFrn: number, parentSeq: number,
 *            usn: number, time: number|null, reason: number, name: string}} Change
 */

/**
 * Parse the records in a slice of $J.
 *
 * @param {Buffer} buf
 * @param {number} baseUsn the USN of buf[0]
 * @returns {{changes: Change[], rest: number}} rest is the offset of a
 *   record cut off by the end of buf, or buf.length; a caller reading on
 *   carries buf[rest..] into the next slice
 */
export function parseUsnRecords(buf, baseUsn) {
  const changes = [];
  let pos = 0;

  while (pos + MIN_RECORD <= buf.length) {
    const length = buf.readUInt32LE(pos);
    const major = buf.readUInt16LE(pos + 4);
    const plausible = length >= MIN_RECORD && length % ALIGN === 0 && usnOffsetOf(major) !== null;

    if (plausible && pos + length > buf.length) {
      if (usnAt(buf, pos, major) === null || matchesUsn(buf, pos, major, baseUsn)) break;
    }
    if (plausible && pos + length <= buf.length && matchesUsn(buf, pos, major, baseUsn)) {
      if (major === 2 || major === 3) changes.push(readRecord(buf.subarray(pos, pos + length), major));
      pos += length;
      continue;
    }
    pos += ALIGN;
  }

  return { changes, rest: Math.min(pos, buf.length) };
}

// ---------------------------------------------------------------------------

// Where each version keeps its own USN. v4 (range tracking) shares v3's
// header and is skipped whole.
function usnOffsetOf(major) {
  if (major === 2) return 24;
  if (major === 3 || major === 4) return 40;
  return null;
}

function usnAt(buf, pos, major) {
  const at = pos + usnOffsetOf(major);
  return at + 8 <= buf.length ? Number(buf.readBigInt64LE(at)) : null;
}

function matchesUsn(buf, pos, major, baseUsn) {
  return usnAt(buf, pos, major) === baseUsn + pos;
}

function readRecord(rec, major) {
  const v2 = major === 2;
  const refWidth = v2 ? 8 : 16;
  const own = rec.readBigUInt64LE(8);
  const parent = rec.readBigUInt64LE(8 + refWidth);
  const at = 8 + refWidth * 2; // the USN; the fields after it are the same in both

  const nameLength = rec.readUInt16LE(at + 32);
  const nameOffset = rec.readUInt16LE(at + 34);
  const nameEnd = Math.min(rec.length, nameOffset + nameLength);

  return {
    frn: Number(own & 0xffffffffffffn),
    seq: Number(own >> 48n),
    parentFrn: Number(parent & 0xffffffffffffn),
    parentSeq: Number(parent >> 48n),
    usn: Number(rec.readBigInt64LE(at)),
    time: filetimeToMs(rec.readUInt32LE(at + 12), rec.readUInt32LE(at + 8)),
    reason: rec.readUInt32LE(at + 16),
    name: rec.toString("utf16le", nameOffset, nameEnd),
  };
}
