/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk).
 *
 * Items are laid out largest first. Each row along the shorter side of the
 * space left keeps growing while that makes its worst aspect ratio better;
 * when it would make it worse, the row is fixed and a new one starts. The
 * result is rectangles close to square, which are easy to compare by eye.
 *
 * Pure.
 */

/**
 * @template {{value: number}} T
 * @param {T[]} items values of zero or less get no rectangle
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @returns {Array<{item: T, x: number, y: number, w: number, h: number}>}
 *   largest first; areas are proportional to values and fill rect
 */
export function squarify(items, rect) {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, i) => sum + i.value, 0);
  if (sorted.length === 0 || !(rect.w > 0) || !(rect.h > 0) || !(total > 0)) return [];

  const scale = (rect.w * rect.h) / total;
  const free = { ...rect };
  const out = [];
  let row = [];

  for (const item of sorted) {
    const area = item.value * scale;
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, area], side) <= worst(row, side)) {
      row.push(area);
      continue;
    }
    placeRow(sorted.slice(out.length, out.length + row.length), row, free, out);
    row = [area];
  }
  placeRow(sorted.slice(out.length, out.length + row.length), row, free, out, true);
  return out;
}

/** The worst (largest) aspect ratio in a row laid along `side`. */
export function worst(areas, side) {
  if (areas.length === 0 || side <= 0) return Infinity;
  let sum = 0;
  let max = 0;
  let min = Infinity;
  for (const a of areas) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/** Aspect ratio of one rectangle, always >= 1. */
export function aspect({ w, h }) {
  if (!(w > 0) || !(h > 0)) return Infinity;
  return Math.max(w / h, h / w);
}

/**
 * Lay a row along the shorter side of the free space and shrink the free
 * space past it. The last row takes all that is left, so rounding cannot
 * leave a sliver uncovered.
 */
function placeRow(items, areas, free, out, last = false) {
  const sum = areas.reduce((s, a) => s + a, 0);

  if (free.w >= free.h) {
    // A column at the left edge.
    const thick = last ? free.w : Math.min(free.w, sum / free.h);
    let y = free.y;
    areas.forEach((a, i) => {
      const h = i === areas.length - 1 ? free.y + free.h - y : a / thick;
      out.push({ item: items[i], x: free.x, y, w: thick, h });
      y += h;
    });
    free.x += thick;
    free.w -= thick;
  } else {
    // A row along the top edge.
    const thick = last ? free.h : Math.min(free.h, sum / free.w);
    let x = free.x;
    areas.forEach((a, i) => {
      const w = i === areas.length - 1 ? free.x + free.w - x : a / thick;
      out.push({ item: items[i], x, y: free.y, w, h: thick });
      x += w;
    });
    free.y += thick;
    free.h -= thick;
  }
}
