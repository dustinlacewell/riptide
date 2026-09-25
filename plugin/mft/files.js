/**
 * What each file record last added to the tree, indexed by record number.
 *
 * The stream folds a file into its parent's totals and drops it. To take a
 * file back out later — it was deleted, grew or moved — the tree must know
 * what that file put in. These arrays keep exactly that, about 18 bytes a
 * record, instead of an object per file:
 *
 *   parent  Uint32   parent folder's record number; NO_PARENT when the
 *                    record holds no file
 *   size    Float64  bytes
 *   mtime   Uint32   modified time, whole seconds since 1970; 0 undated
 *   seq     Uint16   the record's sequence number
 *   match   Map      record -> bitmask of the name patterns it matched;
 *                    only files that matched one are held
 *
 * A record past the end grows the arrays: the MFT can grow between reads.
 */

export const NO_PARENT = 0xffffffff;

const MAX_SECONDS = 0xffffffff;

// One entry of the match Map, measured with V8's heap stats.
const MATCH_ENTRY_BYTES = 38;

/**
 * @param {number} [size] records to reserve
 */
export function createFileTable(size = 0) {
  return {
    parent: new Uint32Array(size).fill(NO_PARENT),
    size: new Float64Array(size),
    mtime: new Uint32Array(size),
    seq: new Uint16Array(size),
    match: new Map(),
  };
}

/**
 * @param {ReturnType<typeof createFileTable>} table
 * @param {number} n record number
 * @param {{parent: number, size: number, mtime: number, seq: number, mask: number}} file
 */
export function putFile(table, n, { parent, size, mtime, seq, mask }) {
  if (n >= table.parent.length) grow(table, n + 1);
  table.parent[n] = parent;
  table.size[n] = size;
  table.mtime[n] = mtime;
  table.seq[n] = seq;
  if (mask !== 0) table.match.set(n, mask);
  else table.match.delete(n);
}

/**
 * The file a record holds, or null.
 *
 * @returns {null|{parent: number, size: number, mtime: number, seq: number, mask: number}}
 */
export function fileAt(table, n) {
  if (n >= table.parent.length || table.parent[n] === NO_PARENT) return null;
  return {
    parent: table.parent[n],
    size: table.size[n],
    mtime: table.mtime[n],
    seq: table.seq[n],
    mask: table.match.get(n) ?? 0,
  };
}

/** Forget the file a record held. */
export function dropFile(table, n) {
  if (n >= table.parent.length) return;
  table.parent[n] = NO_PARENT;
  table.size[n] = 0;
  table.mtime[n] = 0;
  table.seq[n] = 0;
  table.match.delete(n);
}

/** Bytes the table holds, for the memory estimate. */
export function tableBytes(table) {
  return (
    table.parent.byteLength +
    table.size.byteLength +
    table.mtime.byteLength +
    table.seq.byteLength +
    table.match.size * MATCH_ENTRY_BYTES
  );
}

/**
 * Unix ms to whole seconds for the mtime column; 0 for no time, and for a
 * time the column cannot hold.
 *
 * @param {number|null} ms
 */
export function toSeconds(ms) {
  if (ms === null || !(ms >= 1000)) return 0;
  return Math.min(Math.floor(ms / 1000), MAX_SECONDS);
}

// ---------------------------------------------------------------------------

function grow(table, need) {
  const length = Math.max(need, table.parent.length * 2);
  const parent = new Uint32Array(length).fill(NO_PARENT);
  parent.set(table.parent);
  table.parent = parent;
  table.size = extend(Float64Array, table.size, length);
  table.mtime = extend(Uint32Array, table.mtime, length);
  table.seq = extend(Uint16Array, table.seq, length);
}

function extend(Type, from, length) {
  const next = new Type(length);
  next.set(from);
  return next;
}
