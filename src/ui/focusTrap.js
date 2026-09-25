/**
 * Tab and Shift+Tab inside a modal: which element takes focus next.
 *
 * Pure: it sees positions, not the DOM. Returns the index to focus, or
 * null to let the browser move focus itself (the next element is still
 * inside the dialog).
 *
 * @param {number} count focusable elements in the dialog
 * @param {number} index where focus is now; -1 when on none of them (the
 *        dialog box itself)
 * @param {boolean} backwards Shift is held
 * @returns {number|null}
 */
export function trapTarget(count, index, backwards) {
  if (count === 0) return -1;
  const last = count - 1;
  if (index === -1) return backwards ? last : 0;
  if (backwards && index === 0) return last;
  if (!backwards && index === last) return 0;
  return null;
}

/** What counts as a tab stop inside a dialog. */
export const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
