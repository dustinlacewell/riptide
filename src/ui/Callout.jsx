import Glyph from "./Glyph.jsx";

const TONE_GLYPH = { caution: "caution", refused: "lock", info: null };

/**
 * A boxed message set apart from the flow.
 *
 *   caution  dashed amber: read this before you go on
 *   refused  red: something will not happen
 *   info     quiet: context, no action needed
 *
 * The title is optional; the tone's glyph sits beside it.
 */
export default function Callout({ tone = "info", title, children }) {
  const glyph = TONE_GLYPH[tone];
  return (
    <div className={`callout callout-${tone}`}>
      {title && (
        <div className="callout-title">
          {glyph && <Glyph name={glyph} size={12} />}
          <span>{title}</span>
        </div>
      )}
      {children && <div className="callout-body">{children}</div>}
    </div>
  );
}
