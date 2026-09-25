/**
 * What a path names on disk now, in the map's terms: the identify that
 * offer.js is given.
 *
 * On NTFS a file ID is the file reference: the low 48 bits are the MFT
 * record number, the high 16 a reuse count. Map reads are NTFS-only
 * (mft/boot.js), so a path on any other filesystem cannot match and is
 * refused.
 */

import fsp from "node:fs/promises";

const RECORD_BITS = 0xffffffffffffn;

/**
 * @param {string} full
 * @returns {Promise<{isDir: boolean, recNo: number}|null>} null when the
 *          path is gone or cannot be read
 */
export async function identifyFolder(full) {
  try {
    const s = await fsp.stat(full, { bigint: true });
    return { isDir: s.isDirectory(), recNo: Number(s.ino & RECORD_BITS) };
  } catch {
    return null;
  }
}
