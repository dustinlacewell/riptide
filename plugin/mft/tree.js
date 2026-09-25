/**
 * Rebuild the directory tree from flat MFT records, and roll sizes up.
 *
 * Each record carries its parent's MFT record number, so the whole tree
 * falls out of a single pass with no directory reads at all. This is the
 * payoff for parsing the MFT: no tree walk, no per-directory syscalls.
 */

// MFT record 5 is always the volume root directory.
export const ROOT_RECORD = 5;

/**
 * Index records by record number for path resolution.
 *
 * @param {Iterable<{recordNumber: number}>} records
 * @returns {Map<number, object>}
 */
export function indexRecords(records) {
  const byNumber = new Map();
  for (const rec of records) byNumber.set(rec.recordNumber, rec);
  return byNumber;
}

/**
 * Index directory records by their parent's record number.
 *
 * The root is its own parent on NTFS; it is left out of its own child list
 * so a walk down from the root cannot loop back to it.
 *
 * @param {Map<number, object>} dirs directory records by record number
 * @returns {Map<number, object[]>}
 */
export function childIndex(dirs) {
  const childrenOf = new Map();
  for (const rec of dirs.values()) {
    if (rec.recordNumber === rec.parent) continue;
    let list = childrenOf.get(rec.parent);
    if (!list) childrenOf.set(rec.parent, (list = []));
    list.push(rec);
  }
  return childrenOf;
}

/**
 * Resolve a record to a full path.
 *
 * Returns null when the chain is broken (a deleted parent) or cyclic. A
 * cycle should not occur on a healthy volume, but a partially-written MFT
 * read from a live system can produce one, and an unguarded walk would spin
 * forever.
 *
 * @param {Map<number, object>} byNumber
 * @param {object} record
 * @param {string} driveLetter e.g. "C:"
 * @returns {string|null}
 */
export function resolvePath(byNumber, record, driveLetter) {
  const parts = [];
  const seen = new Set();
  let current = record;

  while (current && current.recordNumber !== ROOT_RECORD) {
    if (seen.has(current.recordNumber)) return null;
    seen.add(current.recordNumber);

    parts.push(current.name);
    current = byNumber.get(current.parent);
  }

  if (!current) return null;

  parts.reverse();
  return `${driveLetter}\\${parts.join("\\")}`;
}

/**
 * Sum the total size of a directory and everything beneath it.
 *
 * Works from per-directory tallies rather than individual file records, so
 * the caller can discard file records as they stream and keep memory
 * proportional to the directory count.
 *
 * Walks iteratively; recursion would risk a stack overflow on a deep tree.
 *
 * @param {Map<number, object>} dirs directory records by record number
 * @param {Map<number, bigint>} ownBytes bytes of files directly in each dir
 * @param {Map<number, number>} ownFiles count of files directly in each dir
 * @param {Iterable<number>} rootNumbers directories to total
 * @param {Map<number, object[]>} [children] from childIndex, when the caller
 *        already built one
 * @returns {Map<number, {bytes: bigint, files: number}>}
 */
export function subtreeSizes(dirs, ownBytes, ownFiles, rootNumbers, children = childIndex(dirs)) {
  const totals = new Map();

  for (const rootNumber of rootNumbers) {
    let bytes = 0n;
    let files = 0;
    const stack = [rootNumber];
    const seen = new Set();

    while (stack.length > 0) {
      const number = stack.pop();
      if (seen.has(number)) continue;
      seen.add(number);

      bytes += ownBytes.get(number) ?? 0n;
      files += ownFiles.get(number) ?? 0;

      for (const child of children.get(number) ?? []) {
        stack.push(child.recordNumber);
      }
    }

    totals.set(rootNumber, { bytes, files });
  }

  return totals;
}

/**
 * Find directories whose name matches, excluding any nested inside another
 * match. A node_modules inside a node_modules is already covered by its
 * ancestor, and listing both would double-count the bytes and delete twice.
 *
 * @param {Map<number, object>} byNumber
 * @param {(name: string) => boolean} matches
 * @returns {Array<object>}
 */
export function findOutermostMatches(byNumber, matches) {
  const hits = [];
  for (const rec of byNumber.values()) {
    if (rec.isDirectory && matches(rec.name)) hits.push(rec);
  }

  const hitNumbers = new Set(hits.map((h) => h.recordNumber));

  return hits.filter((hit) => !hasMatchingAncestor(byNumber, hit, hitNumbers));
}

function hasMatchingAncestor(byNumber, record, hitNumbers) {
  const seen = new Set([record.recordNumber]);
  let current = byNumber.get(record.parent);

  while (current && current.recordNumber !== ROOT_RECORD) {
    if (seen.has(current.recordNumber)) return false;
    seen.add(current.recordNumber);
    if (hitNumbers.has(current.recordNumber)) return true;
    current = byNumber.get(current.parent);
  }

  return false;
}
