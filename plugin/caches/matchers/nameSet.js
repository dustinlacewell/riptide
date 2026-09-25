/**
 * A list of folder and file names, shared by `beside` and `contains`.
 *
 *   "ProjectSettings/"   a folder (trailing slash) — read from the tree
 *   "Cargo.toml"         a file — read from the MFT marks
 *   "*.csproj"           a file by extension — read from the MFT marks
 *
 * Folders may be any glob. Files must be an exact name or *.ext, because
 * those are the two shapes the MFT stream can test with a Set lookup.
 * The list matches when ANY entry is present.
 */

import { classifyName, compileGlob } from "../glob.js";
import { markId } from "../../mft/filenames.js";
import { parseStringList } from "./list.js";

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {{folders: Array<{pattern: string, test: Function}>,
 *            files: string[]} | {error: string}}
 */
export function parseNameSet(value, key) {
  const list = parseStringList(value, key);
  if (list.error) return list;

  const folders = [];
  const files = [];

  for (const raw of list) {
    const folder = raw.endsWith("/");
    const pattern = folder ? raw.slice(0, -1) : raw;
    const kind = classifyName(pattern);

    if (kind.kind === "rejected") return { error: `${key}: ${kind.reason}` };
    if (folder) {
      folders.push({ pattern, test: compileGlob(pattern) });
    } else if (kind.kind === "glob") {
      return { error: `${key}: file pattern "${raw}" must be a name or *.ext` };
    } else {
      files.push(pattern);
    }
  }

  return { folders, files };
}

export function describeNameSet(spec) {
  return [...spec.folders.map((f) => `${f.pattern}/`), ...spec.files].join(", ");
}

/**
 * Does directory `dirNumber` hold any of the listed names?
 *
 * @param {{children: Map, marks: Map}} tree
 * @param {number} dirNumber
 * @param {{folders: object[], files: string[]}} spec
 * @param {number} [except] a child record to ignore (the located folder
 *        itself, when looking beside it)
 */
export function holdsAny(tree, dirNumber, spec, except = -1) {
  const marked = tree.marks?.get(dirNumber);
  if (marked && spec.files.some((f) => marked.has(markId(f)))) return true;

  if (spec.folders.length === 0) return false;
  for (const child of tree.children.get(dirNumber) ?? []) {
    if (child.recordNumber === except) continue;
    if (spec.folders.some((f) => f.test(child.name))) return true;
  }
  return false;
}
