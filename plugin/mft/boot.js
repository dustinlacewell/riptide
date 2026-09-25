/**
 * NTFS boot sector ($Boot) parsing.
 *
 * The first 512 bytes of an NTFS volume describe the geometry we need to
 * locate the MFT: how big a cluster is, and which cluster the MFT starts at.
 */

const NTFS_OEM_ID = "NTFS    ";

/**
 * Parse the volume boot record.
 *
 * @param {Buffer} buf at least 512 bytes read from offset 0 of the volume
 * @returns {{bytesPerSector: number, sectorsPerCluster: number,
 *            bytesPerCluster: number, mftCluster: bigint,
 *            bytesPerFileRecord: number, mftOffset: bigint}}
 */
export function parseBootSector(buf) {
  if (buf.length < 512) {
    throw new Error(`boot sector too short: ${buf.length} bytes`);
  }

  const oem = buf.toString("latin1", 3, 11);
  if (oem !== NTFS_OEM_ID) {
    throw new Error(`not an NTFS volume (OEM id ${JSON.stringify(oem)})`);
  }

  const bytesPerSector = buf.readUInt16LE(0x0b);
  const sectorsPerCluster = buf.readUInt8(0x0d);
  const mftCluster = buf.readBigUInt64LE(0x30);

  if (bytesPerSector === 0 || (bytesPerSector & (bytesPerSector - 1)) !== 0) {
    throw new Error(`bad bytesPerSector: ${bytesPerSector}`);
  }
  if (sectorsPerCluster === 0) {
    throw new Error("bad sectorsPerCluster: 0");
  }

  const bytesPerCluster = bytesPerSector * sectorsPerCluster;

  return {
    bytesPerSector,
    sectorsPerCluster,
    bytesPerCluster,
    mftCluster,
    bytesPerFileRecord: decodeClustersPerRecord(
      buf.readInt8(0x40),
      bytesPerCluster,
    ),
    mftOffset: mftCluster * BigInt(bytesPerCluster),
  };
}

/**
 * The "clusters per file record" field is signed and overloaded: a positive
 * value counts clusters, a negative value is a log2 byte size. This trips
 * people up because on most modern volumes the record is 1024 bytes while the
 * cluster is 4096, so the field holds -10, not a cluster count.
 */
function decodeClustersPerRecord(raw, bytesPerCluster) {
  if (raw > 0) return raw * bytesPerCluster;
  const size = 1 << -raw;
  if (size < 1 || size > 1 << 20) {
    throw new Error(`implausible file record size from field ${raw}`);
  }
  return size;
}
