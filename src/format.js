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

export function sumBytes(values) {
  return values.reduce((total, v) => total + BigInt(v), 0n).toString();
}

export function when(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
