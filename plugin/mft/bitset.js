/**
 * A bitset over non-negative integers (MFT record numbers).
 *
 * One bit per record: 4.87M records cost about 610 KB. The size is a hint,
 * not a limit — the MFT can grow while it is read, so a bit past the end
 * grows the words instead of being dropped.
 */

/**
 * @param {number} [size] how many bits to reserve up front
 * @returns {{set: (i: number) => void, clear: (i: number) => void,
 *            has: (i: number) => boolean, readonly bytes: number}}
 */
export function createBitset(size = 0) {
  let words = new Uint32Array(wordsFor(size));

  const grow = (i) => {
    const next = new Uint32Array(Math.max(wordsFor(i + 1), words.length * 2));
    next.set(words);
    words = next;
  };

  return {
    set(i) {
      const w = i >>> 5;
      if (w >= words.length) grow(i);
      words[w] |= 1 << (i & 31);
    },
    clear(i) {
      const w = i >>> 5;
      if (w < words.length) words[w] &= ~(1 << (i & 31));
    },
    has(i) {
      const w = i >>> 5;
      return w < words.length && (words[w] & (1 << (i & 31))) !== 0;
    },
    get bytes() {
      return words.byteLength;
    },
  };
}

function wordsFor(bits) {
  return Math.ceil(Math.max(0, bits) / 32);
}
