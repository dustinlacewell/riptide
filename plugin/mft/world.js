/**
 * Test helper: a small volume that changes at random, and the journal
 * records those changes would write.
 *
 * A world is record number -> record spec (fakeVolume.js buildRecord
 * shape). step() makes one random change — create, delete, rename, move,
 * resize, touch, record reuse — and returns the USN change specs NTFS
 * would log for it: the file with its old parent, and with its new parent
 * when it moved. A folder whose entries change gets a new time, as NTFS
 * gives it, but no journal record of its own.
 *
 * Seeded, so a failing case replays.
 */

const NAMES = ["a.js", "b.txt", "Cargo.toml", "package.json", "x.csproj", "y.CSPROJ", "notes.md", "lib.rs"];
const DIR_NAMES = ["src", "target", "node_modules", "build", "docs"];

/** mulberry32: a small seeded PRNG. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} seed
 * @param {{records?: number, first?: number}} [opts] records is the MFT's
 *        size; first the lowest record number a change may use
 */
export function createWorld(seed, { records = 64, first = 50 } = {}) {
  const rand = random(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  let time = 1_600_000_000_000;
  const tick = () => (time += int(1, 5000));

  const specs = new Map([[5, { name: ".", parent: 5, isDirectory: true, seq: 5, mtime: tick() }]]);
  const seqs = new Map(); // record -> last sequence number used

  const dirs = () => [...specs].filter(([, s]) => s.isDirectory).map(([n]) => n);
  const files = () => [...specs].filter(([, s]) => !s.isDirectory).map(([n]) => n);
  const free = () => {
    const out = [];
    for (let n = first; n < records; n++) if (!specs.has(n)) out.push(n);
    return out;
  };
  const touchDir = (n) => {
    const dir = specs.get(n);
    if (dir) specs.set(n, { ...dir, mtime: tick() });
  };
  const change = (n, spec, parent) => ({
    frn: n,
    seq: spec.seq,
    parentFrn: parent,
    parentSeq: specs.get(parent)?.seq ?? 0,
    name: spec.name,
    time,
  });

  function create(isDirectory) {
    const slots = free();
    if (slots.length === 0) return [];
    const n = pick(slots);
    const seq = (seqs.get(n) ?? 0) + 1; // a reused slot gets a new seq
    seqs.set(n, seq);
    const parent = pick(dirs());
    const spec = isDirectory
      ? { name: `${pick(DIR_NAMES)}${n}`, parent, isDirectory: true, seq, mtime: tick() }
      : { name: pick(NAMES), parent, size: int(0, 500), mtime: rand() < 0.1 ? null : tick(), seq };
    specs.set(n, spec);
    touchDir(parent);
    return [change(n, spec, parent)];
  }

  function remove(n) {
    const spec = specs.get(n);
    if (spec.isDirectory && [...specs.values()].some((s) => s.parent === n && s !== spec)) return [];
    specs.delete(n);
    touchDir(spec.parent);
    return [change(n, spec, spec.parent)];
  }

  function edit(n, patch) {
    const spec = specs.get(n);
    const next = { ...spec, ...patch };
    specs.set(n, next);
    const out = [change(n, spec, spec.parent)];
    if (next.parent !== spec.parent) {
      touchDir(spec.parent);
      touchDir(next.parent);
      out.push(change(n, next, next.parent));
    } else if (next.name !== spec.name) {
      touchDir(spec.parent);
    }
    return out;
  }

  /** One random change; returns its journal specs (maybe none). */
  function step() {
    tick();
    const f = files();
    const d = dirs().filter((n) => n !== 5);
    const roll = rand();
    if (roll < 0.25 || f.length === 0) return create(false);
    if (roll < 0.33) return create(true);
    if (roll < 0.45) return remove(pick(f));
    if (roll < 0.5 && d.length > 0) return remove(pick(d));
    if (roll < 0.62) return edit(pick(f), { size: int(0, 500), mtime: tick() });
    if (roll < 0.72) return edit(pick(f), { name: pick(NAMES) });
    if (roll < 0.84) return edit(pick(f), { parent: pick(dirs()) });
    if (roll < 0.9 && d.length > 0) return edit(pick(d), { name: `${pick(DIR_NAMES)}x` });
    if (d.length > 0) return edit(pick(d), { parent: 5 });
    return [];
  }

  return { specs, step, now: () => time };
}
