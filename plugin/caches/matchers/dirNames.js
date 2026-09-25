/**
 * `dirNames`: a folder found by name anywhere, rather than at a fixed place.
 *
 *   "dirNames": [".vite", "target", "cmake-build-*"]
 *
 * These live inside projects, so every directory on the volume is a
 * candidate. Exact names are one Map lookup per directory; glob names are
 * tested one by one, which is fine for the handful a pack set carries.
 */

import { classifyName, compileGlob } from "../glob.js";
import { parseStringList } from "./list.js";

export default {
  key: "dirNames",
  role: "locate",
  perProject: true,

  parse(value) {
    const list = parseStringList(value, "dirNames");
    if (list.error) return list;

    const names = [];
    for (const pattern of list) {
      const kind = classifyName(pattern);
      if (kind.kind === "rejected") return { error: `dirNames: ${kind.reason}` };
      names.push({ pattern, glob: kind.kind !== "exact" });
    }
    return { names };
  },

  describe(spec) {
    return `folders named ${spec.names.map((n) => n.pattern).join(", ")}`;
  },

  drives() {
    return "all";
  },

  locate(tree, items) {
    const exact = new Map();
    const globs = [];

    for (const item of items) {
      for (const name of item.spec.names) {
        if (name.glob) {
          globs.push({ item, test: compileGlob(name.pattern) });
        } else {
          const key = name.pattern.toLowerCase();
          if (!exact.has(key)) exact.set(key, []);
          exact.get(key).push(item);
        }
      }
    }

    const hits = [];
    for (const record of tree.dirs.values()) {
      if (record.recordNumber === record.parent) continue; // the root
      for (const item of exact.get(record.name.toLowerCase()) ?? []) {
        hits.push({ rule: item.rule, record, wild: false });
      }
      for (const glob of globs) {
        if (glob.test(record.name)) hits.push({ rule: glob.item.rule, record, wild: true });
      }
    }
    return hits;
  },
};
