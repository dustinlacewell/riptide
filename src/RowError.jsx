import Glyph from "./ui/Glyph.jsx";

/** Why a row's delete failed, inline in the row. */
export default function RowError({ error }) {
  return (
    <span className="row-error" title={error}>
      <Glyph name="failed" size={12} label="Failed" />
      <span>{error}</span>
    </span>
  );
}
