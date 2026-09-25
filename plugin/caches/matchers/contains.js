/**
 * `contains`: the located folder itself must hold one of these names.
 *
 *   { "dirNames": ["build"], "contains": ["CMakeCache.txt"] }
 *
 * CMake writes CMakeCache.txt inside its build folder, so a `build` holding
 * one is a CMake build tree. See nameSet.js for the folder/file syntax.
 */

import { parseNameSet, describeNameSet, holdsAny } from "./nameSet.js";

export default {
  key: "contains",
  role: "filter",

  parse(value) {
    return parseNameSet(value, "contains");
  },

  describe(spec) {
    return `containing ${describeNameSet(spec)}`;
  },

  needs(spec) {
    return spec.files;
  },

  test(tree, record, spec) {
    return holdsAny(tree, record.recordNumber, spec);
  },
};
