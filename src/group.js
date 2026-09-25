/**
 * Grouping for the Caches table.
 *
 * A per-project rule such as __pycache__ matches once per project, so one
 * scan returns thousands of rows for a single rule. The table is only
 * readable if each rule is one row that opens to show its instances.
 *
 * Sizes are BigInt strings throughout: a rule's instances sum well past the
 * safe integer range, so a sum must never pass through Number.
 */

import { cmpBigInt } from "./sort.js";

/**
 * Collapse hits into one entry per cache rule.
 *
 * Rules are keyed by id, not by label: two packs may name a cache the same
 * thing, and merging those would report one rule that cannot be reasoned
 * about. Members keep their own paths — selection stays per path.
 *
 * Groups come back in first-seen order; sortGroups decides the display
 * order. Members are always biggest first, which is not user-controlled:
 * the largest instance of a rule is the one worth looking at.
 *
 * @param {Array<object>} hits
 * @returns {Array<object>} one group per id
 */
export function groupHits(hits) {
  const byId = new Map();

  for (const hit of hits) {
    let group = byId.get(hit.id);
    if (!group) {
      group = {
        id: hit.id,
        label: hit.label,
        tool: hit.tool,
        cost: hit.cost,
        caution: hit.caution,
        perProject: hit.perProject,
        paths: [],
        bytes: 0n,
        files: 0,
        count: 0,
      };
      byId.set(hit.id, group);
    }

    group.paths.push(hit);
    group.bytes += BigInt(hit.bytes);
    group.files += hit.files;
    group.count += 1;
  }

  const groups = [...byId.values()];
  for (const group of groups) {
    group.bytes = group.bytes.toString();
    group.paths.sort(bySizeDescending);
  }
  return groups;
}

/**
 * @param {Array<object>} groups
 * @param {{key: string, direction: "asc"|"desc"}} sort
 * @returns {Array<object>} a new sorted array
 */
export function sortGroups(groups, sort) {
  const compare = GROUP_COMPARATORS[sort.key] ?? GROUP_COMPARATORS.bytes;
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => sign * compare(a, b));
}

const GROUP_COMPARATORS = {
  // Labels are unique per rule once grouped, so ties are rare; size breaks
  // the ones that remain.
  label: (a, b) =>
    a.label.localeCompare(b.label) || -cmpBigInt(BigInt(a.bytes), BigInt(b.bytes)),
  count: (a, b) => a.count - b.count,
  bytes: (a, b) => cmpBigInt(BigInt(a.bytes), BigInt(b.bytes)),
  files: (a, b) => a.files - b.files,
};

function bySizeDescending(a, b) {
  return -cmpBigInt(BigInt(a.bytes), BigInt(b.bytes));
}
