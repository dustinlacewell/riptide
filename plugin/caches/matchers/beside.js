/**
 * `beside`: the located folder's parent must also hold one of these names.
 *
 *   { "dirNames": ["target"], "beside": ["Cargo.toml"] }
 *   { "dirNames": ["Library"], "beside": ["ProjectSettings/"] }
 *
 * A `target` next to a Cargo.toml is Cargo's; one elsewhere is not ours to
 * judge. See nameSet.js for the folder/file syntax.
 */

import { parseNameSet, describeNameSet, holdsAny } from "./nameSet.js";

export default {
  key: "beside",
  role: "filter",

  parse(value) {
    return parseNameSet(value, "beside");
  },

  describe(spec) {
    return `next to ${describeNameSet(spec)}`;
  },

  needs(spec) {
    return spec.files;
  },

  test(tree, record, spec) {
    if (record.parent === record.recordNumber) return false;
    return holdsAny(tree, record.parent, spec, record.recordNumber);
  },
};
