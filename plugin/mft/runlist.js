/**
 * NTFS data run decoding.
 *
 * A non-resident attribute stores its content as a list of extents ("runs")
 * on the volume. Each run is a variable-length record:
 *
 *   [header byte][length field][offset field]
 *
 * The header packs two nibbles: the low nibble is the byte count of the
 * length field, the high nibble the byte count of the offset field. A header
 * of 0x00 terminates the list.
 *
 * The offset is a *signed* delta from the previous run's start cluster, not
 * an absolute address. Runs can therefore move backwards on the volume. An
 * offset field of zero length marks a sparse run (a hole) with no clusters
 * allocated; its LCN is null and its content reads as zeros.
 */

/**
 * Decode a run list into extents.
 *
 * @param {Buffer} buf buffer positioned at the start of the run list
 * @param {number} [start=0] offset within buf to begin at
 * @returns {Array<{vcn: bigint, lcn: bigint|null, length: bigint}>}
 */
export function decodeRunList(buf, start = 0) {
  const runs = [];
  let pos = start;
  let lcn = 0n;
  let vcn = 0n;

  while (pos < buf.length) {
    const header = buf.readUInt8(pos);
    pos += 1;
    if (header === 0) break;

    const lengthSize = header & 0x0f;
    const offsetSize = (header >> 4) & 0x0f;

    if (lengthSize === 0) {
      throw new Error(`run at ${pos - 1} has zero-length length field`);
    }
    if (pos + lengthSize + offsetSize > buf.length) {
      throw new Error(`run at ${pos - 1} extends past end of buffer`);
    }

    const length = readUnsignedLE(buf, pos, lengthSize);
    pos += lengthSize;

    if (offsetSize === 0) {
      // Sparse run: no clusters allocated, LCN does not advance.
      runs.push({ vcn, lcn: null, length });
    } else {
      lcn += readSignedLE(buf, pos, offsetSize);
      pos += offsetSize;
      runs.push({ vcn, lcn, length });
    }

    vcn += length;
  }

  return runs;
}

/**
 * Map run extents onto byte ranges on the volume, skipping sparse holes.
 *
 * @param {Array<{vcn: bigint, lcn: bigint|null, length: bigint}>} runs
 * @param {number} bytesPerCluster
 * @returns {Array<{offset: bigint, length: bigint}>}
 */
export function runsToByteRanges(runs, bytesPerCluster) {
  const cluster = BigInt(bytesPerCluster);
  const ranges = [];
  for (const run of runs) {
    if (run.lcn === null) continue;
    ranges.push({
      offset: run.lcn * cluster,
      length: run.length * cluster,
    });
  }
  return ranges;
}

function readUnsignedLE(buf, pos, size) {
  let value = 0n;
  for (let i = size - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(buf.readUInt8(pos + i));
  }
  return value;
}

function readSignedLE(buf, pos, size) {
  let value = readUnsignedLE(buf, pos, size);
  const bits = BigInt(size * 8);
  const signBit = 1n << (bits - 1n);
  if (value & signBit) value -= 1n << bits;
  return value;
}
