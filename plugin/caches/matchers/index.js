/**
 * The matcher registry.
 *
 * Every non-meta key in a pack entry names a matcher here. A matcher either
 * locates folders (paths, drivePaths, dirNames) or filters located ones
 * (under, beside, contains). Adding a kind of rule means adding one matcher
 * file and one line below — nothing else changes.
 *
 * Matcher interface:
 *
 *   { key, role: "locate"|"filter",
 *     parse(value) -> spec | {error},
 *     describe(spec) -> string }
 *
 *   locate adds: perProject: boolean,
 *                drives(spec, ctx) -> drive[] | "all",
 *                locate(tree, [{rule, spec}], ctx) -> [{rule, record, wild}]
 *   filter adds: needs(spec) -> file pattern[],
 *                test(tree, record, spec) -> boolean
 *
 * tree: {dirs, children, marks, drive}   ctx: {env, drives, scope}
 *
 * Order matters only for display: an entry's `where` lists its rules in
 * this order.
 */

import paths from "./paths.js";
import drivePaths from "./drivePaths.js";
import dirNames from "./dirNames.js";
import under from "./under.js";
import beside from "./beside.js";
import contains from "./contains.js";

export const MATCHERS = [paths, drivePaths, dirNames, under, beside, contains];

const BY_KEY = new Map(MATCHERS.map((m) => [m.key, m]));

/**
 * @param {string} key
 * @returns {object|null}
 */
export function matcherFor(key) {
  return BY_KEY.get(key) ?? null;
}
