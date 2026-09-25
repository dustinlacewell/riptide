/**
 * `under`: the located folder's immediate parent must have this name.
 *
 *   { "dirNames": [".vite"], "under": "node_modules" }
 *
 * Vite's cache is node_modules/.vite; this keeps a stray .vite elsewhere
 * from matching.
 */

export default {
  key: "under",
  role: "filter",

  parse(value) {
    if (typeof value !== "string" || value.trim() === "") {
      return { error: "under must be a folder name" };
    }
    return { name: value.toLowerCase(), label: value };
  },

  describe(spec) {
    return `inside ${spec.label}`;
  },

  needs() {
    return [];
  },

  test(tree, record, spec) {
    if (record.parent === record.recordNumber) return false;
    const parent = tree.dirs.get(record.parent);
    return parent?.name.toLowerCase() === spec.name;
  },
};
