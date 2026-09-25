/**
 * Match pack entries against one volume's directory tree.
 *
 * Pure: the tree is already read, so this is a function of data. The steps:
 *
 *   locate   each locate matcher finds candidate folders, batched per key
 *   filter   every filter rule on the entry must pass
 *   dedupe   a folder claimed by two entries goes to the earlier one
 *   nest     a hit inside another hit is dropped — the outer one covers it,
 *            and counting both would double the bytes
 *   place    build each hit's full path
 *   scope    keep only hits under the chosen root, if there is one
 *   screen   the Zap tab's protected-path rule, applied to the concrete
 *            paths — after wildcards resolve, never before. A wildcard hit
 *            must also pass the depth rule.
 */

import { ROOT_RECORD, resolvePath } from "../mft/tree.js";
import { screenPaths } from "../zap.js";
import { MATCHERS, matcherFor } from "./matchers/index.js";

/**
 * @param {{dirs: Map, children: Map, marks: Map, drive: string}} tree
 * @param {object[]} entries validated pack entries, in priority order
 * @param {{env: object, drives: string[], scope: string|null}} ctx scope is
 *        lowercased with no trailing separator
 * @returns {{hits: Array<{entry: object, record: object, path: string}>,
 *            refused: Array<{path: string, reason: string, record: object}>}}
 */
export function matchTree(tree, entries, ctx) {
  const located = locate(tree, entries, ctx);
  const filtered = located.filter((hit) => passesFilters(tree, hit));
  const unique = dedupe(filtered, entries);
  const outer = dropNested(tree.dirs, unique);
  const placed = place(tree, outer);
  const scoped = ctx.scope ? placed.filter((hit) => withinScope(hit.path, ctx.scope)) : placed;
  return screen(scoped);
}

// ---------------------------------------------------------------------------

function locate(tree, entries, ctx) {
  const hits = [];
  for (const matcher of MATCHERS) {
    if (matcher.role !== "locate") continue;
    const items = [];
    for (const entry of entries) {
      for (const { key, spec } of entry.match) {
        if (key === matcher.key) items.push({ rule: entry, spec });
      }
    }
    if (items.length > 0) hits.push(...matcher.locate(tree, items, ctx));
  }
  return hits;
}

function passesFilters(tree, hit) {
  return hit.rule.match.every(({ key, spec }) => {
    const matcher = matcherFor(key);
    return matcher.role !== "filter" || matcher.test(tree, hit.record, spec);
  });
}

function dedupe(hits, entries) {
  const order = new Map(entries.map((e, i) => [e, i]));
  const byRecord = new Map();
  for (const hit of hits) {
    const held = byRecord.get(hit.record.recordNumber);
    if (!held || order.get(hit.rule) < order.get(held.rule)) {
      byRecord.set(hit.record.recordNumber, hit);
    }
  }
  return [...byRecord.values()];
}

function dropNested(dirs, hits) {
  const matched = new Set(hits.map((h) => h.record.recordNumber));
  return hits.filter((hit) => !hasMatchedAncestor(dirs, hit.record, matched));
}

function hasMatchedAncestor(dirs, record, matched) {
  const seen = new Set([record.recordNumber]);
  let current = dirs.get(record.parent);

  while (current && current.recordNumber !== ROOT_RECORD) {
    if (seen.has(current.recordNumber)) return false;
    seen.add(current.recordNumber);
    if (matched.has(current.recordNumber)) return true;
    current = dirs.get(current.parent);
  }
  return false;
}

function place(tree, hits) {
  const out = [];
  for (const hit of hits) {
    const full = resolvePath(tree.dirs, hit.record, tree.drive);
    if (full !== null) out.push({ ...hit, path: full });
  }
  return out;
}

/**
 * Is `full` the scope directory or inside it?
 * The separator check stops "D:\code" from matching "D:\code-archive".
 */
function withinScope(full, scope) {
  const lower = full.toLowerCase();
  return lower === scope || lower.startsWith(scope + "\\");
}

/**
 * The protected-folder rules live in protect.js, through screenPaths.
 * Depth is waived for a named path: real stores do sit at a drive root
 * (D:\.pnpm-store). It is not waived for anything a wildcard produced.
 */
function screen(hits) {
  const hitsOut = [];
  const refused = [];

  for (const hit of hits) {
    const result = screenPaths([hit.path], { requireDepth: hit.wild === true });
    if (result.refused.length > 0) {
      // The record goes with the refusal so a caller can mark the folder.
      refused.push(...result.refused.map((r) => ({ ...r, record: hit.record })));
      continue;
    }
    hitsOut.push({ entry: hit.rule, record: hit.record, path: hit.path });
  }

  return { hits: hitsOut, refused };
}
