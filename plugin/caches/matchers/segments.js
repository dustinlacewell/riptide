/**
 * Walk a path template down the directory tree, one segment at a time.
 *
 * Shared by the paths and drivePaths matchers. A literal segment matches one
 * child by name (case-insensitive). A wildcard segment ("*", "*.default")
 * fans out to every child it matches.
 *
 * Wildcards are where a pack could reach further than its author meant, so
 * two rules hold them in:
 *
 *   - the last segment must be literal, so a template always names a
 *     specific folder ("…\*\caches"), never "every child of X";
 *   - a wildcard never passes through a protected folder: each path it
 *     produces is screened on the spot, and a refused branch is pruned.
 */

import { ROOT_RECORD } from "../../mft/tree.js";
import { screenPaths } from "../../zap.js";
import { compileGlob, hasWildcard } from "../glob.js";

/**
 * Split a template into segments. Drive letters and env references are
 * ordinary segments here; they are expanded before walking.
 *
 * @param {string} template
 * @returns {string|null} a problem, or null when the template is usable
 */
export function templateProblem(template) {
  const segments = template.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return `"${template}" names no folder`;

  // Expansion normalizes the path, which would collapse ".." and let
  // "…\*\x\.." end on the wildcard after this check passed.
  if (segments.some(isRelative)) {
    return `"${template}": "." and ".." segments are not allowed`;
  }

  const last = segments[segments.length - 1];
  if (hasWildcard(last)) {
    return `"${template}": the last segment must be a literal name`;
  }
  return null;
}

/**
 * @param {{dirs: Map, children: Map, drive: string}} tree
 * @param {string[]} segments below the drive root
 * @returns {Array<{record: object, wild: boolean}>}
 */
export function walkSegments(tree, segments) {
  if (segments.some(isRelative)) return [];

  let frontier = [{ number: ROOT_RECORD, path: `${tree.drive}\\`, wild: false }];

  for (const segment of segments) {
    const next = [];
    const wildcard = hasWildcard(segment);
    const test = compileGlob(segment);

    for (const node of frontier) {
      for (const child of tree.children.get(node.number) ?? []) {
        if (!test(child.name)) continue;
        const full = node.path + (node.path.endsWith("\\") ? "" : "\\") + child.name;
        if (wildcard && isProtected(full)) continue;
        next.push({ number: child.recordNumber, path: full, wild: node.wild || wildcard });
        if (!wildcard) break; // a literal names one child
      }
    }

    frontier = next;
    if (frontier.length === 0) return [];
  }

  return frontier
    .map((node) => ({ record: tree.dirs.get(node.number), wild: node.wild }))
    .filter((hit) => hit.record);
}

function isRelative(segment) {
  return segment === "." || segment === "..";
}

function isProtected(full) {
  return screenPaths([full], { requireDepth: false }).refused.length > 0;
}
