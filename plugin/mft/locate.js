/**
 * Where on the volume a stream's bytes are.
 *
 * A non-resident stream — the MFT itself, or the journal's $J — is a list
 * of runs mapping its clusters (VCNs) to volume clusters (LCNs). These
 * functions turn a byte range of a stream into volume byte ranges, and a
 * set of scattered records into a few aligned reads.
 *
 * Pure. Stream offsets are numbers; volume offsets are bigints, as the
 * reader takes them.
 */

/**
 * The allocated volume ranges behind stream bytes [from, to). Sparse runs
 * hold nothing on disk and are left out.
 *
 * @param {Array<{vcn: bigint, lcn: bigint|null, length: bigint}>} runs
 * @param {number} bytesPerCluster
 * @param {number} from
 * @param {number} to
 * @returns {Array<{offset: bigint, start: number, length: number}>} start
 *   is the stream offset of the range's first byte
 */
export function sliceRanges(runs, bytesPerCluster, from, to) {
  const out = [];
  for (const run of runs) {
    const runStart = Number(run.vcn) * bytesPerCluster;
    const runEnd = runStart + Number(run.length) * bytesPerCluster;
    const lo = Math.max(from, runStart);
    const hi = Math.min(to, runEnd);
    if (hi <= lo || run.lcn === null) continue;
    out.push({
      offset: BigInt(Number(run.lcn) * bytesPerCluster + (lo - runStart)),
      start: lo,
      length: hi - lo,
    });
  }
  return out;
}

/**
 * The volume ranges holding MFT record n: one range, or two when a record
 * larger than a cluster straddles runs. Empty when the MFT does not reach n.
 *
 * @param {Array} mftRuns
 * @param {{bytesPerCluster: number, bytesPerFileRecord: number}} boot
 * @param {number} n
 */
export function recordRanges(mftRuns, boot, n) {
  const size = boot.bytesPerFileRecord;
  const ranges = sliceRanges(mftRuns, boot.bytesPerCluster, n * size, (n + 1) * size);
  const covered = ranges.reduce((sum, r) => sum + r.length, 0);
  return covered === size ? ranges : [];
}

/**
 * Group scattered pieces into few reads: sorted by offset, widened to
 * `align`, and merged when the gap between them is small.
 *
 * @template K
 * @param {Array<{offset: bigint, length: number, key: K, at?: number}>} pieces
 *   at is where the piece goes in whatever the caller assembles
 * @param {{align: number, gap?: number, max?: number}} opts
 * @returns {Array<{offset: bigint, length: number,
 *                  parts: Array<{key: K, at: number, from: number, length: number}>}>}
 *   from is the part's offset within the read
 */
export function planReads(pieces, { align, gap = 64 * 1024, max = 4 * 1024 * 1024 }) {
  const sorted = pieces
    .map((p) => ({ ...p, start: Number(p.offset) }))
    .sort((a, b) => a.start - b.start);

  const spans = [];
  let span = null;

  for (const piece of sorted) {
    const lo = floorTo(piece.start, align);
    const hi = ceilTo(piece.start + piece.length, align);
    if (span && lo - span.end <= gap && Math.max(hi, span.end) - span.begin <= max) {
      span.end = Math.max(span.end, hi);
    } else {
      span = { begin: lo, end: hi, pieces: [] };
      spans.push(span);
    }
    span.pieces.push(piece);
  }

  return spans.map((s) => ({
    offset: BigInt(s.begin),
    length: s.end - s.begin,
    parts: s.pieces.map((p) => ({ key: p.key, at: p.at ?? 0, from: p.start - s.begin, length: p.length })),
  }));
}

function floorTo(n, step) {
  return n - (n % step);
}

function ceilTo(n, step) {
  return n % step === 0 ? n : n + step - (n % step);
}
