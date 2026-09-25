/**
 * Streaming the MFT: read every extent in order and fold the records into
 * a directory tree, reporting progress on a clock.
 *
 * The reader is injected — (offset, length) => Buffer — so the loop runs
 * on a synthetic buffer in tests and never needs a raw volume.
 */

import { applyFixup, parseFileRecord } from "./record.js";
import { addRecord, createTree } from "./fold.js";

const READ_CHUNK = 8 * 1024 * 1024;

// Reading the clock per record would cost more than the parse; every few
// thousand records is often enough to hit the interval.
const CHECK_EVERY = 4096;
const EMIT_MS = 100;

/**
 * Records the extents hold, whole records only.
 *
 * @param {Array<{length: bigint}>} ranges
 * @param {number} recordSize
 */
export function recordsIn(ranges, recordSize) {
  const bytes = ranges.reduce((sum, r) => sum + r.length, 0n);
  return { mftBytes: bytes, recordsTotal: Number(bytes / BigInt(recordSize)) };
}

/**
 * A gate that opens at most once per interval.
 *
 * @param {() => number} clock milliseconds
 * @param {number} everyMs
 * @returns {() => boolean} true when the interval has passed since it last
 *          returned true (or since it was made)
 */
export function intervalGate(clock, everyMs) {
  let last = clock();
  return () => {
    const now = clock();
    if (now - last < everyMs) return false;
    last = now;
    return true;
  };
}

/**
 * Read every MFT extent sequentially and parse the records within.
 *
 * Only directory records are retained as objects. A volume with millions
 * of files cannot afford a JS object per file — on this machine that came
 * to 1.3 GB of heap and killed the dev server. Files are folded into their
 * parent's running total as they stream past (fold.js); what each one
 * added stays in typed arrays of about 18 bytes a record, so a later
 * change can take it back out.
 *
 * Progress: {stage: "mft-stream", recordsDone, recordsTotal, bytesRead,
 * dirs, matches?} at most every 100 ms. matches counts directories whose
 * name passes countMatch, and is present only when countMatch is given.
 *
 * @param {{read: (offset: bigint, length: number) => Promise<Buffer>,
 *          ranges: Array<{offset: bigint, length: bigint}>,
 *          boot: {bytesPerFileRecord: number, bytesPerSector: number},
 *          query?: object|null, countMatch?: (name: string) => boolean,
 *          onProgress?: Function, signal?: AbortSignal,
 *          clock?: () => number}} opts
 * @returns {Promise<ReturnType<typeof createTree> & {recordsDone: number}>}
 *   the tree fold.js describes
 */
export async function streamMftRecords({
  read,
  ranges,
  boot,
  query = null,
  countMatch = null,
  onProgress = () => {},
  signal,
  clock = () => performance.now(),
}) {
  const recordSize = boot.bytesPerFileRecord;
  const { recordsTotal } = recordsIn(ranges, recordSize);
  const tree = createTree({ size: recordsTotal, query });
  const due = intervalGate(clock, EMIT_MS);

  let recordNumber = 0;
  let bytesRead = 0;
  let matches = 0;

  const report = () =>
    onProgress({
      stage: "mft-stream",
      recordsDone: recordNumber,
      recordsTotal,
      bytesRead,
      dirs: tree.dirs.size,
      ...(countMatch ? { matches } : {}),
    });

  for (const range of ranges) {
    let consumed = 0n;

    while (consumed < range.length) {
      signal?.throwIfAborted();
      const remaining = range.length - consumed;
      const want = remaining < BigInt(READ_CHUNK) ? Number(remaining) : READ_CHUNK;
      const chunk = await read(range.offset + consumed, want);
      if (chunk.length === 0) break;
      bytesRead += chunk.length;

      const usable = chunk.length - (chunk.length % recordSize);

      for (let off = 0; off + recordSize <= usable; off += recordSize) {
        const rec = chunk.subarray(off, off + recordSize);
        const current = recordNumber++;
        if (recordNumber % CHECK_EVERY === 0 && due()) report();

        try {
          applyFixup(rec, boot.bytesPerSector);
        } catch {
          // A torn record on a live volume. Skip it rather than abort the
          // whole scan; one bad record costs us one file, not the run.
          continue;
        }

        const entry = parseFileRecord(rec, current);
        if (!entry) continue;

        addRecord(tree, current, entry);
        if (entry.isDirectory && countMatch?.(entry.name)) matches += 1;
      }

      consumed += BigInt(usable > 0 ? usable : chunk.length);
    }
  }

  return Object.assign(tree, { recordsDone: recordNumber });
}
