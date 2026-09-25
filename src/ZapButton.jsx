import { bytes } from "./format.js";
import { zapTone } from "./reclaim.js";
import Glyph from "./ui/Glyph.jsx";

/**
 * The button that starts a delete: "Zap 312 folders · 41.8 GB", or with
 * actions picked, "Zap 3 locations + 2 commands · 1.2 GB".
 *
 * Cyan when every pick is safe, amber when any carries a caution, red only
 * when the delete skips the Recycle Bin.
 *
 * @param {{count: number, noun: [string, string], bytes: string,
 *          commands?: number, anyCaution: boolean, permanent: boolean,
 *          busy?: boolean, disabled?: boolean, onClick: () => void}} props
 *   noun is [singular, plural]
 */
export default function ZapButton({
  count,
  noun,
  bytes: size,
  commands = 0,
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
      <span>{busy ? "Checking…" : `Zap ${picks(count, noun, commands)} · ${bytes(size)}`}</span>
    </button>
  );
}

function picks(count, noun, commands) {
  const paths = `${count.toLocaleString()} ${count === 1 ? noun[0] : noun[1]}`;
  const cmds = `${commands.toLocaleString()} ${commands === 1 ? "command" : "commands"}`;
  if (commands === 0) return paths;
  if (count === 0) return cmds;
  return `${paths} + ${cmds}`;
}
