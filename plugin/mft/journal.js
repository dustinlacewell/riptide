/**
 * Read the NTFS change journal over the raw volume.
 *
 *   readJournalInfo   where $J is, how far it has been written, its id
 *   readChanges       the change records from one USN to the end
 *   findUsnAt         a USN at or before the first change after a time
 *
 * The journal is the file $Extend\$UsnJrnl. Its record number comes from
 * the full MFT read (fold.js spots it). Its $J stream is sparse and its
 * runs usually spill into extension records (attrlist.js); a USN is a
 * byte offset into $J, mapped to the volume through those runs
 * (locate.js).
 *
 * I/O goes through the injected reader; every parser is pure.
 */

import { ATTR_DATA, parseFileRecord } from "./record.js";
import {
  ATTR_ATTRIBUTE_LIST,
  assembleAttribute,
  attributesOf,
  parseAttributeList,
  recordsHolding,
} from "./attrlist.js";
import { sliceRanges } from "./locate.js";
import { readRawRecords } from "./reread.js";
import { parseMax, parseUsnRecords } from "./usn.js";

const JOURNAL_NAME = "$UsnJrnl";
const READ_CHUNK = 8 * 1024 * 1024;
const PAGE = 4096;

/**
 * @typedef {{id: bigint, lowestValidUsn: number, maxSize: number,
 *            nextUsn: number, runs: Array}} JournalInfo
 */

/**
 * @param {{read: Function, boot: object, mftRuns: Array, record: number|null,
 *          signal?: AbortSignal}} opts
 * @returns {Promise<JournalInfo|null>} null when the volume has no journal
 *   at that record — never made, deleted, or the record reused
 */
export async function readJournalInfo({ read, boot, mftRuns, record, signal }) {
  if (record === null || record === undefined) return null;
  const { records } = await readRawRecords({ read, boot, mftRuns, numbers: [record], signal });
  const base = records.get(record);
  if (!base || parseFileRecord(base, record)?.name !== JOURNAL_NAME) return null;

  const parts = [base, ...(await extensionsOf({ read, boot, mftRuns, record, base, signal }))];
  const max = assembleAttribute(parts, ATTR_DATA, "$Max");
  const j = assembleAttribute(parts, ATTR_DATA, "$J");
  if (!max || !j?.runs) return null;

  const maxBytes = max.content ?? (await readStream(read, boot.bytesPerCluster, max.runs, 0, 32));
  return { ...parseMax(maxBytes), nextUsn: Number(j.dataSize), runs: j.runs };
}

/**
 * The change records in [from, info.nextUsn), up to the first page NTFS
 * has not flushed yet.
 *
 * @param {{read: Function, boot: object, info: JournalInfo, from: number,
 *          signal?: AbortSignal}} opts
 * @returns {Promise<{changes: import("./usn.js").Change[], end: number}>}
 *   end is where the next read must start: info.nextUsn, or the start of
 *   an unflushed page, so that page is read again once it is written
 */
export async function readChanges({ read, boot, info, from, signal }) {
  const changes = [];
  let carry = null; // { usn, bytes }: a record cut off by the last read

  for (const piece of pieces(info.runs, boot.bytesPerCluster, from, info.nextUsn)) {
    signal?.throwIfAborted();
    const bytes = await readPiece(read, boot.bytesPerCluster, piece);
    const joined = carry && carry.usn + carry.bytes.length === piece.start;
    const buf = joined ? Buffer.concat([carry.bytes, bytes]) : bytes;
    const base = joined ? carry.usn : piece.start;

    const { changes: found, rest, hole } = parseUsnRecords(buf, base);
    changes.push(...found);
    if (hole !== null) return { changes, end: hole };
    carry = { usn: base + rest, bytes: Buffer.from(buf.subarray(rest)) };
  }
  return { changes, end: info.nextUsn };
}

/**
 * A USN to read from so as to see every change made at or after `time`.
 * Binary search over $J's pages by the time of each page's first record;
 * it errs early, which costs only changes seen twice.
 *
 * @param {{read: Function, boot: object, info: JournalInfo, time: number}} opts
 *   time is Unix ms
 * @returns {Promise<number>}
 */
export async function findUsnAt({ read, boot, info, time }) {
  const pages = pageStarts(info.runs, boot.bytesPerCluster, info.lowestValidUsn, info.nextUsn);
  if (pages.length === 0) return info.nextUsn;

  let lo = 0;
  let hi = pages.length; // the first page whose first record is at or after time
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const first = await firstTimeOnPage({ read, boot, info, usn: pages[mid] });
    // A page with no time (not flushed yet) could hold anything: treat it
    // as late, so the search lands early rather than past a change.
    if (first === null || first >= time) hi = mid;
    else lo = mid + 1;
  }
  return pages[Math.max(0, lo - 1)];
}

// ---------------------------------------------------------------------------

async function extensionsOf({ read, boot, mftRuns, record, base, signal }) {
  const listAttr = attributesOf(base).find((a) => a.type === ATTR_ATTRIBUTE_LIST);
  if (!listAttr) return [];
  const content =
    listAttr.content ??
    (await readStream(read, boot.bytesPerCluster, listAttr.runs, 0, Number(listAttr.dataSize)));
  const list = parseAttributeList(content);
  const numbers = [
    ...recordsHolding(list, record, ATTR_DATA, "$J"),
    ...recordsHolding(list, record, ATTR_DATA, "$Max"),
  ];
  if (numbers.length === 0) return [];
  const { records } = await readRawRecords({ read, boot, mftRuns, numbers, signal });
  return [...records.values()].filter(Boolean);
}

/** Stream bytes [from, to) as one buffer; sparse parts read as zeros. */
async function readStream(read, bytesPerCluster, runs, from, to) {
  const out = Buffer.alloc(to - from);
  for (const piece of pieces(runs, bytesPerCluster, from, to)) {
    (await readPiece(read, bytesPerCluster, piece)).copy(out, piece.start - from);
  }
  return out;
}

/** Allocated ranges of [from, to), cut to at most READ_CHUNK each. */
function* pieces(runs, bytesPerCluster, from, to) {
  for (const range of sliceRanges(runs, bytesPerCluster, from, to)) {
    for (let done = 0; done < range.length; done += READ_CHUNK) {
      yield {
        offset: range.offset + BigInt(done),
        start: range.start + done,
        length: Math.min(READ_CHUNK, range.length - done),
      };
    }
  }
}

/**
 * One piece, read with its ends widened to cluster boundaries — a raw
 * volume takes only sector-aligned reads — then cut back.
 */
async function readPiece(read, bytesPerCluster, { offset, start, length }) {
  const head = start % bytesPerCluster;
  const end = head + length;
  const span = end % bytesPerCluster === 0 ? end : end + bytesPerCluster - (end % bytesPerCluster);
  const buf = await read(offset - BigInt(head), span);
  return buf.subarray(head, Math.min(buf.length, end));
}

function pageStarts(runs, bytesPerCluster, from, to) {
  const out = [];
  for (const range of sliceRanges(runs, bytesPerCluster, from, to)) {
    const first = range.start - (range.start % PAGE);
    for (let usn = first; usn < range.start + range.length; usn += PAGE) out.push(Math.max(usn, range.start));
  }
  return out;
}

async function firstTimeOnPage({ read, boot, info, usn }) {
  const end = Math.min(info.nextUsn, usn - (usn % PAGE) + PAGE);
  const bytes = await readStream(read, boot.bytesPerCluster, info.runs, usn, end);
  const { changes } = parseUsnRecords(bytes, usn);
  return changes.find((c) => c.time !== null)?.time ?? null;
}
