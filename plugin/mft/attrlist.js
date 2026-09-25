/**
 * Attributes that live in more than one record.
 *
 * A file with many extents or attributes outgrows its 1 KB record. NTFS
 * then moves attributes into extension records and lists where each one
 * went in an $ATTRIBUTE_LIST (0x20) in the base record. One large
 * attribute can itself be split: each piece covers a VCN range and carries
 * its own run list, starting from LCN 0 again.
 *
 * The change journal's $J stream is exactly this case, so finding its runs
 * means: read the base record, read the list, read the extension records
 * it names, then stitch the pieces of $J together in VCN order.
 *
 * Pure: every function takes buffers already read and fixed up.
 */

import { decodeRunList } from "./runlist.js";

export const ATTR_ATTRIBUTE_LIST = 0x20;

/**
 * Every attribute header in one record.
 *
 * @param {Buffer} rec a record, fixups applied
 * @returns {Array<{type: number, name: string, nonResident: boolean,
 *                  lowestVcn: bigint, dataSize: bigint,
 *                  content: Buffer|null, runs: Array|null}>}
 *   content for a resident attribute; runs, with absolute VCNs, for a
 *   non-resident one
 */
export function attributesOf(rec) {
  const out = [];
  let pos = rec.readUInt16LE(0x14);

  while (pos + 8 <= rec.length) {
    const type = rec.readUInt32LE(pos);
    if (type === 0xffffffff) break;
    const length = rec.readUInt32LE(pos + 4);
    if (length < 0x18 || pos + length > rec.length) break;

    out.push(readAttribute(rec.subarray(pos, pos + length), type));
    pos += length;
  }
  return out;
}

/**
 * Parse an $ATTRIBUTE_LIST's content.
 *
 * @param {Buffer} content
 * @returns {Array<{type: number, name: string, lowestVcn: bigint,
 *                  record: number, seq: number}>}
 */
export function parseAttributeList(content) {
  const out = [];
  let pos = 0;

  while (pos + 0x1a <= content.length) {
    const type = content.readUInt32LE(pos);
    const length = content.readUInt16LE(pos + 4);
    if (type === 0 || type === 0xffffffff || length < 0x1a || pos + length > content.length) break;

    const nameLength = content.readUInt8(pos + 6);
    const nameOffset = content.readUInt8(pos + 7);
    const reference = content.readBigUInt64LE(pos + 0x10);
    out.push({
      type,
      name: content.toString("utf16le", pos + nameOffset, pos + nameOffset + nameLength * 2),
      lowestVcn: content.readBigUInt64LE(pos + 8),
      record: Number(reference & 0xffffffffffffn),
      seq: Number(reference >> 48n),
    });
    pos += length;
  }
  return out;
}

/**
 * Records other than the base that hold a piece of the named attribute.
 *
 * @param {ReturnType<typeof parseAttributeList>} list
 * @param {number} baseRecord
 * @param {number} type
 * @param {string} name
 * @returns {number[]}
 */
export function recordsHolding(list, baseRecord, type, name) {
  const numbers = list
    .filter((e) => e.type === type && e.name === name && e.record !== baseRecord)
    .map((e) => e.record);
  return [...new Set(numbers)];
}

/**
 * One attribute put back together from its pieces across records.
 *
 * @param {Buffer[]} records the base record and any extension records
 * @param {number} type
 * @param {string} name
 * @returns {null|{content: Buffer|null, runs: Array|null, dataSize: bigint}}
 *   null when no record holds it. runs are in VCN order with absolute VCNs;
 *   dataSize comes from the piece at VCN 0, the only one that carries it.
 */
export function assembleAttribute(records, type, name) {
  const pieces = records
    .flatMap(attributesOf)
    .filter((a) => a.type === type && a.name === name);
  if (pieces.length === 0) return null;

  const residentPiece = pieces.find((p) => !p.nonResident);
  if (residentPiece) {
    return { content: residentPiece.content, runs: null, dataSize: BigInt(residentPiece.content.length) };
  }

  pieces.sort((a, b) => (a.lowestVcn < b.lowestVcn ? -1 : a.lowestVcn > b.lowestVcn ? 1 : 0));
  const first = pieces.find((p) => p.lowestVcn === 0n);
  return {
    content: null,
    runs: pieces.flatMap((p) => p.runs),
    dataSize: first ? first.dataSize : 0n,
  };
}

// ---------------------------------------------------------------------------

function readAttribute(attr, type) {
  const nonResident = attr.readUInt8(8) === 1;
  const nameLength = attr.readUInt8(9);
  const nameOffset = attr.readUInt16LE(10);
  const name = attr.toString("utf16le", nameOffset, nameOffset + nameLength * 2);

  if (!nonResident) {
    const contentLength = attr.readUInt32LE(0x10);
    const contentOffset = attr.readUInt16LE(0x14);
    const end = Math.min(attr.length, contentOffset + contentLength);
    return {
      type,
      name,
      nonResident,
      lowestVcn: 0n,
      dataSize: BigInt(end - contentOffset),
      content: attr.subarray(contentOffset, end),
      runs: null,
    };
  }

  const lowestVcn = attr.readBigUInt64LE(0x10);
  const runOffset = attr.readUInt16LE(0x20);
  // A piece's run list counts VCNs from its own start.
  const runs = decodeRunList(attr.subarray(runOffset)).map((r) => ({ ...r, vcn: r.vcn + lowestVcn }));
  return {
    type,
    name,
    nonResident,
    lowestVcn,
    dataSize: attr.readBigUInt64LE(0x30),
    content: null,
    runs,
  };
}
