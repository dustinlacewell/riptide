import { bytes, when } from "./format.js";
import RiskBadge from "./RiskBadge.jsx";
import RowPick from "./RowPick.jsx";

/**
 * One found folder in the Zap table. A refused row takes no part in the
 * paint gesture: it cannot be picked, so sweeping over it does nothing.
 */
export default function HitRow({
  hit,
  risk,
  spared,
  enterDelay = 0,
  setChecked,
  onPointerDown,
  onPointerEnter,
}) {
  const refused = risk === "refused";
  const paint = refused
    ? {}
    : {
        onPointerDown: (e) => onPointerDown(e, hit.path),
        onPointerEnter: () => onPointerEnter(hit.path),
      };

  return (
    <tr
      className={rowClass(risk, spared)}
      style={{ animationDelay: `${enterDelay}ms` }}
      {...paint}
    >
      <td>
        <RowPick
          risk={risk}
          checked={!spared}
          onChange={(checked) => setChecked([hit.path], checked)}
          label={hit.path}
        />
      </td>
      <td className="risk-cell">
        <RiskBadge risk={risk} note={refused ? "Never deleted" : hit.riskNote} compact />
      </td>
      <td className="path" title={hit.path}>
        {hit.path}
      </td>
      <td className="num">{bytes(hit.bytes)}</td>
      <td className="num">{hit.files.toLocaleString()}</td>
      <td className="num">{when(hit.mtime)}</td>
    </tr>
  );
}

function rowClass(risk, spared) {
  return ["row-in", risk === "safe" ? "" : risk, spared && risk !== "refused" ? "spared" : ""]
    .filter(Boolean)
    .join(" ");
}
