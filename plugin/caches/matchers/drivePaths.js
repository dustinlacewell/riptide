/**
 * `drivePaths`: a location anchored to a drive root, checked on every drive.
 *
 *   "drivePaths": ["\\.pnpm-store"]
 *
 * A store may live on any volume, so there is no way to know which drive to
 * read except to read them all. `*` segments fan out as for `paths`.
 */

import { parseStringList } from "./list.js";
import { templateProblem, walkSegments } from "./segments.js";

export default {
  key: "drivePaths",
  role: "locate",
  perProject: false,

  parse(value) {
    const templates = parseStringList(value, "drivePaths");
    if (templates.error) return templates;
    for (const template of templates) {
      const problem = templateProblem(template);
      if (problem) return { error: problem };
    }
    return { templates };
  },

  describe(spec) {
    return `any drive: ${spec.templates.join("  ·  ")}`;
  },

  drives() {
    return "all";
  },

  locate(tree, items) {
    const hits = [];
    for (const { rule, spec } of items) {
      for (const template of spec.templates) {
        const segments = template.split(/[\\/]+/).filter(Boolean);
        for (const found of walkSegments(tree, segments)) hits.push({ rule, ...found });
      }
    }
    return hits;
  },
};
