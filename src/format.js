const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function bytes(value) {
  let n = Number(typeof value === "string" ? BigInt(value) : value);
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n < 10 && unit > 0 ? n.toFixed(1) : Math.round(n)} ${UNITS[unit]}`;
}

/** Index into the byte units for a value: 0 = B, 3 = GB. */
export function unitOf(value) {
  let n = Number(value);
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return unit;
}

/**
 * A byte count split for a hero figure: {value: "44.6", unit: "GB"}.
 * `unit` pins the unit, so a figure counting up keeps its final unit.
 */
export function bytesParts(value, unit = unitOf(value)) {
  const n = Number(value) / 1024 ** unit;
  return { value: unit === 0 ? String(Math.round(n)) : n.toFixed(1), unit: UNITS[unit] };
}

/** Elapsed time as mm:ss.t — 16 700 ms is "00:16.7". */
export function clockTime(ms) {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/** A per-second rate, short: "840/s", "9.8k/s", "187k/s", "1.2M/s". */
export function perSecond(rate) {
  const r = Math.max(0, rate);
  if (r < 1000) return `${Math.round(r)}/s`;
  if (r < 1e6) return `${(r / 1000).toFixed(r < 1e4 ? 1 : 0)}k/s`;
  return `${(r / 1e6).toFixed(1)}M/s`;
}

/** A count, short: "812", "41.2k", "4.87M". */
export function compactCount(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 2 : n < 1e5 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(2)}M`;
}

export function sumBytes(values) {
  return values.reduce((total, v) => total + BigInt(v), 0n).toString();
}

/** How long ago a Unix-ms time was: "today", "12d ago", "3mo ago". */
export function when(ms) {
  if (ms === null || ms === undefined) return "—";
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
