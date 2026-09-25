/**
 * The NTFS log's restart area: how far the volume's metadata log has got.
 *
 * Windows writes every metadata change through $LogFile (record 2) and
 * the change journal together. Another NTFS driver (ntfs-3g on Linux or a
 * Mac) writes files without either: it leaves no journal records and
 * resets the log. So the log's current LSN is a witness the journal
 * cannot give: if it went backwards, or it moved while the journal
 * recorded nothing, someone other than this Windows wrote the volume.
 *
 * The stream starts with two restart pages ("RSTR"), each with the fix-up
 * array of any multi-sector record. The restart area inside holds the
 * current LSN; the newer of the two copies wins.
 *
 *   parseRestartPage   pure: one page -> {currentLsn} or null
 *   readLogLsn         reads record 2 and its two restart pages
 */

import { applyFixup, extractMftRuns } from "./record.js";
import { sliceRanges } from "./locate.js";
import { readRawRecords } from "./reread.js";

const LOGFILE_RECORD = 2;
const RESTART_MAGIC = "RSTR";
const PAGE = 4096;

/**
 * @param {Buffer} page one restart page, as read (fix-ups not yet applied);
 *        not modified
 * @param {number} bytesPerSector
 * @returns {{currentLsn: bigint}|null} null when the page is not a valid
 *   restart page — wiped, torn or never written
 */
export function parseRestartPage(page, bytesPerSector) {
  if (page.length < 0x40 || page.toString("latin1", 0, 4) !== RESTART_MAGIC) return null;
  const buf = Buffer.from(page);
  try {
    applyFixup(buf, bytesPerSector);
  } catch {
    return null;
  }
  const areaOffset = buf.readUInt16LE(0x18);
  if (areaOffset < 0x1e || areaOffset + 8 > buf.length) return null;
  return { currentLsn: buf.readBigInt64LE(areaOffset) };
}

/**
 * The newer current LSN of the two restart pages, or null when neither
 * is valid.
 *
 * @param {{read: Function, boot: {bytesPerCluster: number,
 *          bytesPerSector: number, bytesPerFileRecord: number},
 *          mftRuns: Array, signal?: AbortSignal}} opts
 * @returns {Promise<bigint|null>}
 */
export async function readLogLsn({ read, boot, mftRuns, signal }) {
  const { records } = await readRawRecords({ read, boot, mftRuns, numbers: [LOGFILE_RECORD], signal });
  const rec = records.get(LOGFILE_RECORD);
  if (!rec) return null;

  let runs;
  try {
    runs = extractMftRuns(rec); // the unnamed non-resident $DATA of any record
  } catch {
    return null;
  }
  const lsns = [];
  for (const start of [0, PAGE]) {
    const page = await readSlice(read, boot.bytesPerCluster, runs, start, start + PAGE);
    const parsed = page && parseRestartPage(page, boot.bytesPerSector);
    if (parsed) lsns.push(parsed.currentLsn);
  }
  if (lsns.length === 0) return null;
  return lsns.reduce((a, b) => (b > a ? b : a));
}

async function readSlice(read, bytesPerCluster, runs, from, to) {
  const ranges = sliceRanges(runs, bytesPerCluster, from, to);
  if (ranges.length !== 1 || ranges[0].length !== to - from) return null;
  // Both pages start on a cluster boundary when clusters are 4 KB or less.
  const head = Number(ranges[0].offset % BigInt(bytesPerCluster));
  const span = Math.ceil((head + PAGE) / bytesPerCluster) * bytesPerCluster;
  const buf = await read(ranges[0].offset - BigInt(head), span);
  return buf.subarray(head, head + PAGE);
}
