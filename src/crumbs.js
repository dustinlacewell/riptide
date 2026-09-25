/**
 * Breadcrumb splitting for the directory picker.
 *
 * Lives apart from the component for the same reason useRowPainter's
 * decisions do: the path arithmetic is a pure function, and testing it
 * should not need React.
 */

/**
 * Split a path into clickable ancestors, outermost first.
 *
 * Each crumb carries the full path it jumps to, so clicking one is the same
 * operation as clicking a row — there is no relative navigation anywhere.
 *
 * @param {string|null|undefined} full
 * @returns {Array<{label: string, path: string}>}
 */
export function crumbs(full) {
  if (typeof full !== "string" || !full.trim()) return [];

  const parts = full.split(/[\\/]+/).filter(Boolean);
  const out = [];
  let at = "";

  for (const [i, part] of parts.entries()) {
    // The first part is a drive letter, and "C:" alone names the process's
    // current directory on that drive rather than its root. The trailing
    // separator is what makes it the root.
    at = i === 0 ? `${part}\\` : `${at}${at.endsWith("\\") ? "" : "\\"}${part}`;
    out.push({ label: part, path: at });
  }

  return out;
}
