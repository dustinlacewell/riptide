/**
 * MFT file record parsing.
 *
 * Every file and directory on the volume has a record here, typically 1 KB.
 * We only need three attributes:
 *
 *   $STANDARD_INFORMATION (0x10) — timestamps
 *   $FILE_NAME            (0x30) — name plus the parent's MFT reference
 *   $DATA                 (0x80) — size
 *
 * The parent reference in $FILE_NAME is what lets us rebuild the whole
 * directory tree from a flat scan: each record knows its parent's record
 * number, so one pass builds the entire parent/child graph.
 */

import { decodeRunList } from "./runlist.js";

const SIGNATURE = "FILE";

export const ATTR_STANDARD_INFORMATION = 0x10;
export const ATTR_FILE_NAME = 0x30;
export const ATTR_DATA = 0x80;

const FLAG_IN_USE = 0x0001;
const FLAG_DIRECTORY = 0x0002;

// $FILE_NAME namespace values. A file can carry several $FILE_NAME
// attributes — one long name and one 8.3 short name. We prefer anything
// that is not DOS-only so we report "node_modules", never "NODE_M~1".
const NAMESPACE_DOS = 2;

/**
 * Apply the NTFS fixup (update sequence) array in place.
 *
 * NTFS overwrites the last two bytes of every sector in a record with a
 * signature, and stashes the real bytes in an array in the header. This is a
 * torn-write detector. If you skip this step every 512th byte pair in your
 * data is garbage, which corrupts names and sizes in ways that look random.
 *
 * @param {Buffer} rec one file record, modified in place
 * @param {number} bytesPerSector
 */
export function applyFixup(rec, bytesPerSector) {
  const usaOffset = rec.readUInt16LE(0x04);
  const usaCount = rec.readUInt16LE(0x06);
  if (usaCount === 0) return;

  const signature = rec.readUInt16LE(usaOffset);

  // First entry is the signature itself; the rest are the saved bytes, one
  // per sector.
  for (let i = 1; i < usaCount; i++) {
    const sectorEnd = i * bytesPerSector - 2;
    if (sectorEnd + 2 > rec.length) break;

    const found = rec.readUInt16LE(sectorEnd);
    if (found !== signature) {
      throw new Error(
        `fixup mismatch in sector ${i}: expected ${signature}, found ${found}`,
      );
    }
    rec.writeUInt16LE(rec.readUInt16LE(usaOffset + i * 2), sectorEnd);
  }
}

/**
 * Parse one MFT file record.
 *
 * @param {Buffer} rec a single record, fixups already applied
 * @param {number} recordNumber this record's index in the MFT
 * @returns {null|{recordNumber: number, isDirectory: boolean, name: string,
 *                 parent: number, size: bigint, mtime: number|null,
 *                 seq: number}}
 *          mtime is the $STANDARD_INFORMATION modified time, Unix ms.
 *          seq is the header's sequence number: it moves each time the
 *          record is reused, so (recordNumber, seq) names one file.
 *          null when the record is unused or not a real entry
 */
export function parseFileRecord(rec, recordNumber) {
  if (rec.length < 48) return null;
  if (rec.toString("latin1", 0, 4) !== SIGNATURE) return null;

  const flags = rec.readUInt16LE(0x16);
  if ((flags & FLAG_IN_USE) === 0) return null;

  const isDirectory = (flags & FLAG_DIRECTORY) !== 0;

  let name = null;
  let nameSpace = null;
  let parent = null;
  let size = 0n;
  let mtime = null;

  let pos = rec.readUInt16LE(0x14);

  while (pos + 4 <= rec.length) {
    const type = rec.readUInt32LE(pos);
    if (type === 0xffffffff) break;
    if (pos + 8 > rec.length) break;

    const attrLength = rec.readUInt32LE(pos + 4);
    if (attrLength === 0 || pos + attrLength > rec.length) break;

    const nonResident = rec.readUInt8(pos + 8) === 1;

    if (type === ATTR_STANDARD_INFORMATION && !nonResident) {
      const content = residentContent(rec, pos);
      if (content && content.length >= 24) {
        mtime = filetimeToMs(content.readUInt32LE(12), content.readUInt32LE(8));
      }
    } else if (type === ATTR_FILE_NAME && !nonResident) {
      const content = residentContent(rec, pos);
      if (content && content.length >= 0x42) {
        // Layout: name length at 0x40, namespace at 0x41, name from 0x42.
        // Reversing these two truncates every name to 1-3 characters,
        // because the namespace byte is a small enum.
        const nameLength = content.readUInt8(0x40);
        const thisNamespace = content.readUInt8(0x41);
        const nameEnd = 0x42 + nameLength * 2;
        if (nameEnd > content.length) {
          pos += attrLength;
          continue;
        }
        const thisName = content.toString("utf16le", 0x42, nameEnd);
        // Prefer a non-DOS name; take a DOS name only if nothing else.
        if (name === null || (nameSpace === NAMESPACE_DOS && thisNamespace !== NAMESPACE_DOS)) {
          name = thisName;
          nameSpace = thisNamespace;
          parent = Number(content.readBigUInt64LE(0) & 0x0000ffffffffffffn);
        }
      }
    } else if (type === ATTR_DATA) {
      // Only the unnamed $DATA stream counts toward the file's size.
      const nameLength = rec.readUInt8(pos + 9);
      if (nameLength === 0) {
        size = nonResident
          ? rec.readBigUInt64LE(pos + 0x30)
          : BigInt(rec.readUInt32LE(pos + 0x10));
      }
    }

    pos += attrLength;
  }

  if (name === null || parent === null) return null;

  return { recordNumber, isDirectory, name, parent, size, mtime, seq: rec.readUInt16LE(0x10) };
}

/**
 * Extract the MFT's own $DATA run list from record 0. This is how we learn
 * where the rest of the MFT lives, since the MFT is itself a file and is
 * usually fragmented across the volume.
 *
 * @param {Buffer} rec record 0, fixups already applied
 * @returns {Array<{vcn: bigint, lcn: bigint|null, length: bigint}>}
 */
export function extractMftRuns(rec) {
  let pos = rec.readUInt16LE(0x14);

  while (pos + 8 <= rec.length) {
    const type = rec.readUInt32LE(pos);
    if (type === 0xffffffff) break;

    const attrLength = rec.readUInt32LE(pos + 4);
    if (attrLength === 0 || pos + attrLength > rec.length) break;

    const nonResident = rec.readUInt8(pos + 8) === 1;
    const nameLength = rec.readUInt8(pos + 9);

    if (type === ATTR_DATA && nonResident && nameLength === 0) {
      const runOffset = rec.readUInt16LE(pos + 0x20);
      return decodeRunList(rec.subarray(pos + runOffset, pos + attrLength));
    }

    pos += attrLength;
  }

  throw new Error("record 0 has no non-resident unnamed $DATA attribute");
}

function residentContent(rec, attrPos) {
  const contentLength = rec.readUInt32LE(attrPos + 0x10);
  const contentOffset = rec.readUInt16LE(attrPos + 0x14);
  const start = attrPos + contentOffset;
  const end = start + contentLength;
  if (end > rec.length) return null;
  return rec.subarray(start, end);
}

const EPOCH_DIFF_MS = 11644473600000;
const TICKS_PER_MS = 10000;
const TWO_POW_32 = 4294967296;

/**
 * Windows FILETIME is 100ns ticks since 1601-01-01 UTC. Read as two 32-bit
 * halves and combined as a double: this runs once per record, and a BigInt
 * or a Date per record is millions of allocations. The double loses a few
 * ticks of precision, far below a millisecond.
 *
 * @returns {number|null} Unix milliseconds
 */
function filetimeToMs(high, low) {
  if (high === 0 && low === 0) return null;
  return Math.floor((high * TWO_POW_32 + low) / TICKS_PER_MS) - EPOCH_DIFF_MS;
}
