/**
 * When was anything under a folder last changed?
 *
 * The stream folds each folder's newest file time into ownLatest (see
 * stream.js). A subtree's answer is the max over every folder in it. Some
 * folders say nothing about work and are left out, with everything below
 * them: a cache rebuilds on its own, and .git changes on every fetch.
 *
 * Pure: a function of the tree and the tallies.
 */

/**
 * The newest file time under each root, in one post-order pass.
 *
 * Folders are visited once across all roots, so a root nested inside
 * another root costs nothing extra. Walks iteratively; recursion would risk
 * a stack overflow on a deep tree.
 *
 * @param {Map<number, object[]>} children from childIndex
 * @param {Map<number, number>} ownLatest newest file time in each folder, ms
 * @param {Iterable<number>} roots record numbers to answer for
 * @param {(record: object) => boolean} skip true for a folder to leave out,
 *        with its subtree. Never asked about a root itself.
 * @returns {Map<number, number|null>} root -> newest time, null when the
 *          subtree holds no dated file
 */
export function subtreeLatest(children, ownLatest, roots, skip) {
  const latest = new Map();
  const out = new Map();

  for (const root of roots) {
    if (!latest.has(root)) foldFrom(root, { children, ownLatest, skip, latest });
    out.set(root, latest.get(root));
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * Post-order from `root`: a folder's value is final once all its kept
 * children have theirs. A folder already on the stack is a cycle (a torn
 * MFT) and contributes nothing the second time.
 */
function foldFrom(root, { children, ownLatest, skip, latest }) {
  const onStack = new Set([root]);
  const stack = [{ number: root, expanded: false }];

  while (stack.length > 0) {
    const top = stack[stack.length - 1];

    if (!top.expanded) {
      top.expanded = true;
      for (const child of children.get(top.number) ?? []) {
        const n = child.recordNumber;
        if (latest.has(n) || onStack.has(n) || skip(child)) continue;
        onStack.add(n);
        stack.push({ number: n, expanded: false });
      }
      continue;
    }

    stack.pop();
    latest.set(top.number, maxOfKept(top.number, { children, ownLatest, skip, latest }));
  }
}

function maxOfKept(number, { children, ownLatest, skip, latest }) {
  let max = ownLatest.get(number) ?? null;
  for (const child of children.get(number) ?? []) {
    const value = latest.get(child.recordNumber);
    if (value === undefined || value === null || skip(child)) continue;
    if (max === null || value > max) max = value;
  }
  return max;
}
