import { bytes, when } from "./format.js";
import RiskBadge from "./RiskBadge.jsx";
import { fateClass } from "./deleteTally.js";
import RowError from "./RowError.jsx";
import RowPick from "./RowPick.jsx";
import { cls } from "./ui/cls.js";

/**
 * One found folder in the Zap table. A refused row takes no part in the
 * paint gesture: it cannot be picked, so sweeping over it does nothing.
 *
 * fate comes from a delete run: a deleted row wipes out, a failed one
 * stays and says why.
 */
export default function HitRow({
  hit,
  risk,
  spared,
  fate = null,
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
      className={cls(
        "row-in",
        risk !== "safe" && risk,
        spared && !refused && "spared",
        fateClass(fate),
      )}
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
        {fate?.error !== undefined ? (
          <RowError error={fate.error} />
        ) : (
          <RiskBadge risk={risk} note={refused ? "Never deleted" : hit.riskNote} compact />
        )}
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
