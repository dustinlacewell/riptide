/**
 * The raw volume: the one place a drive is opened for byte reads.
 *
 * Everything that parses what comes back takes a reader —
 * (offset, length) => Promise<Buffer> — so it runs on synthetic buffers in
 * tests and never needs a real volume.
 */

import fsp from "node:fs/promises";

/**
 * @param {string} drive e.g. "C:"
 * @returns {Promise<{read: (offset: bigint, length: number) => Promise<Buffer>,
 *                    close: () => Promise<void>}>}
 */
export async function openVolume(drive) {
  const handle = await fsp.open(`\\\\.\\${drive}`, "r");
  return {
    read: (offset, length) => readAt(handle, offset, length),
    close: () => handle.close(),
  };
}

async function readAt(handle, offset, length) {
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buf, 0, length, Number(offset));
  return buf.subarray(0, bytesRead);
}
