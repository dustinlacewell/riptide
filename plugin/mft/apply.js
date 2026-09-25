/**
 * Bring a kept tree up to date from the change journal.
 *
 * The journal says which records changed, not what the tree must do about
 * it, and its reason bits are not trusted to say either. Every changed
 * record gets the same treatment, whatever happened to it:
 *
 *   1. take out what the tree stored for it (fold.js removeRecord)
 *   2. add the record as the MFT holds it now, if it holds anything
 *
 * A delete, a create, a rename, a move, a reused record and a change seen
 * twice all fall out of those two steps. The parents a change names are
 * read again too: a folder's own record (its time, its name) moves when
 * its entries do, and a parent whose sequence number differs from ours was
 * replaced.
 *
 * The MFT on disk can lag the journal by a few seconds, so records changed
 * less than LAG_MS before a refresh are read again on the next one.
 *
 *   changedRecords   which records to read again
 *   applyChanges     fold them in
 *   staleReason      when the journal cannot bring the tree up to date
 *
 * No I/O. applyChanges updates the tree in place.
 */

import { addRecord, refreshLatest, removeRecord } from "./fold.js";

export const LAG_MS = 10_000;

/** Past this many changed records a full read is as quick and simpler. */
export const MAX_CHANGES = 200_000;

/**
 * @param {import("./usn.js").Change[]} changes from the journal
 * @param {{recent?: number[], now: number}} opts recent are records the
 *        last refresh asked to see again; now is Unix ms
 * @returns {{numbers: Set<number>, recent: number[]}} numbers to read again;
 *   recent to carry to the next refresh
 */
export function changedRecords(changes, { recent = [], now }) {
  const numbers = new Set(recent);
  const fresh = new Set();
  for (const c of changes) {
    numbers.add(c.frn);
    numbers.add(c.parentFrn);
    if (c.time !== null && now - c.time < LAG_MS) {
      fresh.add(c.frn);
      fresh.add(c.parentFrn);
    }
  }
  return { numbers, recent: [...fresh] };
}

/**
 * Records read back older than the journal says they are.
 *
 * $STANDARD_INFORMATION carries the USN of the file's last journal record.
 * A record whose USN is below the newest journal USN for it has not been
 * flushed to disk yet, however long ago the change was. It is read again
 * next time; LAG_MS alone would give up on it after ten seconds.
 *
 * @param {import("./usn.js").Change[]} changes
 * @param {Map<number, {usn: number|null, seq: number}|null>} entries as re-read
 * @returns {number[]}
 */
export function unflushedRecords(changes, entries) {
  const newest = new Map();
  for (const c of changes) {
    if (!(newest.get(c.frn) >= c.usn)) newest.set(c.frn, c.usn);
  }
  const out = [];
  for (const [frn, usn] of newest) {
    const entry = entries.get(frn);
    if (entry && entry.usn !== null && entry.usn !== undefined && entry.usn < usn) out.push(frn);
  }
  return out;
}

/**
 * @param {object} tree from fold.js, updated in place
 * @param {Iterable<number>} numbers records to re-apply
 * @param {Map<number, object|null>} entries each record as it is now, from
 *        parseFileRecord; null when it holds nothing. A number missing from
 *        entries (a torn read) is left as the tree has it.
 * @returns {{tree: object, stats: {records: number, removed: number, added: number},
 *            dirtyDirs: Set<number>}} dirtyDirs are folders whose own tallies or
 *   whose record changed
 */
export function applyChanges(tree, numbers, entries) {
  const stale = new Set();
  const dirtyDirs = new Set();
  let removed = 0;
  let added = 0;
  let records = 0;

  for (const n of numbers) {
    if (!entries.has(n)) continue;
    records += 1;
    const touched = removeRecord(tree, n, stale);
    if (touched !== null) {
      dirtyDirs.add(touched);
      removed += 1;
    }
    const entry = entries.get(n);
    if (!entry) continue;
    addRecord(tree, n, entry);
    dirtyDirs.add(entry.isDirectory ? n : entry.parent);
    added += 1;
  }

  refreshLatest(tree, stale);
  return { tree, stats: { records, removed, added }, dirtyDirs };
}

/**
 * Why the journal cannot bring a kept tree up to date, or null when it can.
 *
 * @param {{journal: {id: bigint, nextUsn: number}|null, boot: {serial: bigint},
 *          lsn?: bigint|null}} held lsn is the NTFS log's current LSN when
 *          the tree was last brought up to date (logfile.js)
 * @param {{serial: bigint, info: {id: bigint, lowestValidUsn: number,
 *          nextUsn: number}|null, lsn?: bigint|null}} now
 * @returns {string|null}
 */
export function staleReason(held, { serial, info, lsn = null }) {
  if (held.boot.serial !== serial) return "the volume changed";
  if (typeof held.lsn === "bigint") {
    if (lsn === null) return "the NTFS log was reset";
    if (lsn < held.lsn) return "the NTFS log went backwards";
  }
  if (!held.journal) return "the drive had no change journal";
  if (!info) return "the change journal is gone";
  if (info.id !== held.journal.id) return "the change journal was replaced";
  if (held.journal.nextUsn < info.lowestValidUsn) return "the change journal wrapped past the last read";
  if (held.journal.nextUsn > info.nextUsn) return "the change journal went backwards";
  return null;
}

/**
 * The log moved but the journal recorded nothing: the volume was written
 * by something that keeps no journal (another OS's NTFS driver).
 *
 * This can also fire once when Windows checkpoints the log after changes
 * the last update already read. That costs one needless full read; a
 * missed foreign write would cost a wrong tree.
 *
 * @param {{lsn?: bigint|null}} held
 * @param {{lsn: bigint|null, changes: number}} now changes counts journal
 *        records read this time
 * @returns {string|null}
 */
export function foreignWriteReason(held, { lsn, changes }) {
  if (typeof held.lsn !== "bigint" || lsn === null) return null;
  if (lsn !== held.lsn && changes === 0) return "the volume changed with no journal records";
  return null;
}
