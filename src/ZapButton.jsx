import { bytes } from "./format.js";
import { zapTone } from "./reclaim.js";
import Glyph from "./ui/Glyph.jsx";

/**
 * The button that starts a delete: "Zap 312 folders · 41.8 GB".
 *
 * Cyan when every pick is safe, amber when any carries a caution, red only
 * when the delete skips the Recycle Bin.
 *
 * @param {{count: number, noun: [string, string], bytes: string,
 *          anyCaution: boolean, permanent: boolean, busy?: boolean,
 *          disabled?: boolean, onClick: () => void}} props
 *   noun is [singular, plural]
 */
export default function ZapButton({
  count,
  noun,
  bytes: size,
  anyCaution,
  permanent,
  busy = false,
  disabled = false,
  onClick,
}) {
  const tone = zapTone({ anyCaution, permanent });

  return (
    <button className={`zap zap-${tone}`} onClick={onClick} disabled={disabled || busy}>
      <Glyph name="bolt" size={18} />
      <span>
        {busy
          ? "Checking…"
          : `Zap ${count.toLocaleString()} ${count === 1 ? noun[0] : noun[1]} · ${bytes(size)}`}
      </span>
    </button>
  );
}
