import Glyph from "./ui/Glyph.jsx";

const LABEL = { safe: "Safe", caution: "Caution", refused: "Refused" };

/**
 * A row's risk: its own glyph plus the word, so it reads without color.
 * Compact drops the visible word and keeps it for screen readers.
 *
 * @param {"safe"|"caution"|"refused"} risk
 * @param {string} [note] why, shown on hover
 */
export default function RiskBadge({ risk, note, compact = false }) {
  if (compact) {
    return (
      <span className={`risk risk-${risk} risk-compact`} title={note}>
        <Glyph name={risk} size={12} label={LABEL[risk]} />
      </span>
    );
  }

  return (
    <span className={`risk risk-${risk}`} title={note}>
      <Glyph name={risk} size={10} />
      {LABEL[risk]}
    </span>
  );
}
