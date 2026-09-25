/**
 * Read chosen MFT records again, without reading the whole MFT.
 *
 * The records are located through the MFT's run list, sorted, and grouped
 * into a few cluster-aligned reads (locate.js), so a thousand scattered
 * records cost a handful of reads rather than a thousand.
 *
 * I/O goes through the injected reader.
 */

import { applyFixup, parseFileRecord } from "./record.js";
import { planReads, recordRanges } from "./locate.js";

/**
 * @param {{read: (offset: bigint, length: number) => Promise<Buffer>,
 *          boot: {bytesPerCluster: number, bytesPerFileRecord: number,
 *                 bytesPerSector: number},
 *          mftRuns: Array, numbers: Iterable<number>, signal?: AbortSignal}} opts
 * @returns {Promise<{records: Map<number, Buffer|null>, torn: number[]}>}
 *   each record with fixups applied; null when the MFT does not reach it.
 *   A torn record — caught mid-write — is in torn and not in records.
 */
export async function readRawRecords({ read, boot, mftRuns, numbers, signal }) {
  const size = boot.bytesPerFileRecord;
  const out = new Map();
  const pieces = [];

  for (const n of new Set(numbers)) {
    const ranges = recordRanges(mftRuns, boot, n);
    if (ranges.length === 0) {
      out.set(n, null);
      continue;
    }
    out.set(n, Buffer.alloc(size));
    let at = 0;
    for (const r of ranges) {
      pieces.push({ offset: r.offset, length: r.length, key: n, at });
      at += r.length;
    }
  }

  for (const span of planReads(pieces, { align: boot.bytesPerCluster })) {
    signal?.throwIfAborted();
    const buf = await read(span.offset, span.length);
    for (const part of span.parts) {
      buf.copy(out.get(part.key), part.at, part.from, part.from + part.length);
    }
  }

  const torn = [];
  for (const [n, rec] of out) {
    if (!rec) continue;
    try {
      applyFixup(rec, boot.bytesPerSector);
    } catch {
      out.delete(n);
      torn.push(n);
    }
  }
  return { records: out, torn };
}

/**
 * The records parsed, as the stream parses them.
 *
 * @param {Parameters<typeof readRawRecords>[0]} opts
 * @returns {Promise<{entries: Map<number, object|null>, torn: number[]}>}
 *   null for a record that holds no file or folder now
 */
export async function readEntries(opts) {
  const { records, torn } = await readRawRecords(opts);
  const entries = new Map();
  for (const [n, rec] of records) entries.set(n, rec ? parseFileRecord(rec, n) : null);
  return { entries, torn };
}
