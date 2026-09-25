/**
 * The Search tab's demo corpus: a few source files' lines. A search runs
 * the visitor's own pattern over them, so "TODO|FIXME" finds the notes and
 * anything else finds what it matches.
 */

const CODE = "C:\\Users\\dev\\code";

export const FILES = [
  [`${CODE}\\storefront\\src\\cart\\checkout.ts`, [
    [42, "  // TODO: retry the payment call once before showing the error"],
    [87, "  const total = subtotal + shipping; // FIXME: tax is added twice for EU orders"],
    [131, "  // TODO: move the coupon rules into the pricing module"],
  ]],
  [`${CODE}\\storefront\\src\\search\\index.ts`, [
    [18, "// TODO: debounce in the hook, not in every caller"],
    [64, "    // FIXME: an empty query still hits the API"],
  ]],
  [`${CODE}\\tide-api\\src\\routes\\export.rs`, [
    [23, "    // TODO: stream the CSV instead of building it in memory"],
    [58, "    // FIXME: the date column ignores the user's time zone"],
    [97, "    // TODO: rate-limit exports per account"],
    [140, "    // TODO: add a test for an empty result"],
  ]],
  [`${CODE}\\ledger-ui\\src\\components\\Table.jsx`, [
    [12, "// TODO: virtualize rows past a few hundred"],
    [76, "      {/* FIXME: sort arrows point the wrong way in RTL */}"],
  ]],
  [`${CODE}\\atlas\\packages\\api\\src\\auth.ts`, [
    [31, "  // FIXME: refresh tokens never expire"],
    [55, "  // TODO: log failed logins with the client IP"],
    [89, "  // TODO: share the session type with packages/web"],
  ]],
  [`${CODE}\\atlas\\packages\\web\\src\\app\\layout.tsx`, [
    [9, "// TODO: load the fonts with next/font"],
    [27, "    {/* TODO: skip link for keyboard users */}"],
  ]],
  [`${CODE}\\sensor-hub\\src\\sensor\\drivers\\bme280.py`, [
    [44, "    # FIXME: the humidity reading drifts above 40 °C"],
    [71, "    # TODO: read the calibration block once, not per sample"],
    [102, "    # TODO: support the SPI bus"],
    [118, "    # FIXME: a timeout here leaves the bus locked"],
    [150, "    # TODO: expose the raw ADC values for debugging"],
  ]],
  [`${CODE}\\docs-site\\src\\pages\\install.md`, [
    [5, "<!-- TODO: add the winget command -->"],
    [48, "<!-- FIXME: this screenshot shows the old settings dialog -->"],
  ]],
];

/**
 * The files that match, as the server's "file" notes: lines with the
 * matched spans. Throws a SyntaxError for a pattern that is not a regex.
 *
 * @param {{pattern: string, regex?: boolean, caseMode?: string}} opts
 */
export function grepFiles({ pattern, regex = true, caseMode = "smart" }) {
  const source = regex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ignoreCase =
    caseMode === "insensitive" || (caseMode === "smart" && pattern === pattern.toLowerCase());
  const re = new RegExp(source, ignoreCase ? "gi" : "g");

  const files = [];
  for (const [path, rows] of FILES) {
    const lines = [];
    for (const [line, text] of rows) {
      const spans = [...text.matchAll(re)].filter((m) => m[0].length > 0).map((m) => [m.index, m.index + m[0].length]);
      if (spans.length > 0) lines.push({ line, text, spans });
    }
    if (lines.length > 0) {
      const matches = lines.reduce((n, l) => n + l.spans.length, 0);
      files.push({ type: "file", path, matches, truncated: false, lines });
    }
  }
  return files;
}
