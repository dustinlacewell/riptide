import Glyph from "./ui/Glyph.jsx";

/**
 * A row's selection control. A refused row cannot be picked, so it shows a
 * lock in the checkbox's place.
 *
 * @param {"safe"|"caution"|"refused"} risk
 * @param {boolean} checked
 * @param {(checked: boolean) => void} onChange
 * @param {string} label what the row is, for the checkbox's accessible name
 */
export default function RowPick({ risk, checked, onChange, label }) {
  if (risk === "refused") {
    return (
      <span className="lock" title="Never deleted">
        <Glyph name="lock" size={16} label="Never deleted" />
      </span>
    );
  }

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={`Select ${label}`}
    />
  );
}
