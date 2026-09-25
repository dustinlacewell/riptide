/**
 * `paths`: absolute locations once expanded.
 *
 *   "paths": ["%LOCALAPPDATA%\\pnpm\\store", "~/.cargo/registry",
 *             "%LOCALAPPDATA%\\JetBrains\\*\\caches"]
 *
 * A template whose variable is unset on this machine is skipped. A `*`
 * segment fans out to every matching child (see segments.js).
 */

import path from "node:path";

import { expandPath, driveOf } from "../expand.js";
import { parseStringList } from "./list.js";
import { templateProblem, walkSegments } from "./segments.js";

export default {
  key: "paths",
  role: "locate",
  perProject: false,

  parse(value) {
    const templates = parseStringList(value, "paths");
    if (templates.error) return templates;
    for (const template of templates) {
      const problem = templateProblem(template);
      if (problem) return { error: problem };
    }
    return { templates };
  },

  describe(spec) {
    return spec.templates.join("  ·  ");
  },

  drives(spec, ctx) {
    const out = new Set();
    for (const full of expandAll(spec, ctx.env)) out.add(driveOf(full));
    return [...out];
  },

  locate(tree, items, ctx) {
    const hits = [];
    for (const { rule, spec } of items) {
      for (const full of expandAll(spec, ctx.env)) {
        if (driveOf(full) !== tree.drive) continue;
        const segments = full.slice(3).split(/[\\/]+/).filter(Boolean);
        for (const found of walkSegments(tree, segments)) hits.push({ rule, ...found });
      }
    }
    return hits;
  },
};

function expandAll(spec, env) {
  return spec.templates
    .map((template) => expandPath(template, env))
    .filter((full) => full && path.win32.isAbsolute(full) && driveOf(full));
}
