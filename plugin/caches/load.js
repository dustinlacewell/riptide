/**
 * Read pack files from disk.
 *
 * Packs live in `packs/` at the project root, one file per ecosystem
 * (javascript, python, rust, jvm, misc). Every .json in the folder is
 * loaded, so sharing a pack means sending the file and dropping it in.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePack } from "./pack.js";

const PACK_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packs",
);

/**
 * @returns {Promise<{entries: object[], packs: object[], errors: string[]}>}
 */
export async function loadPacks(dir = PACK_DIR) {
  let files;
  try {
    files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {
    return { entries: [], packs: [], errors: [`no pack directory at ${dir}`] };
  }

  const entries = [];
  const packs = [];
  const errors = [];

  // Alphabetical, so a duplicate id always fails against the same pack
  // rather than depending on directory order.
  files.sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const full = path.join(dir, file);

    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(full, "utf8"));
    } catch (err) {
      errors.push(`${file}: ${err.message}`);
      continue;
    }

    let pack;
    try {
      pack = validatePack(parsed, file);
    } catch (err) {
      errors.push(err.message);
      continue;
    }

    // A later pack must not silently shadow an earlier one's entry.
    const known = new Set(entries.map((e) => e.id));
    for (const entry of pack.entries) {
      if (known.has(entry.id)) {
        errors.push(`${file}: duplicate id "${entry.id}" — already defined`);
        continue;
      }
      entries.push(entry);
    }

    for (const problem of pack.errors) {
      errors.push(`${file}: ${problem.entry} — ${problem.reason}`);
    }

    packs.push({
      name: pack.name,
      description: pack.description,
      file,
      count: pack.entries.length,
    });
  }

  return { entries, packs, errors };
}

export { PACK_DIR };
