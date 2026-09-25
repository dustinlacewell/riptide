import { bytes } from "./format.js";
import { riskOf } from "./risk.js";
import RiskBadge from "./RiskBadge.jsx";
import Glyph from "./ui/Glyph.jsx";
import { cls } from "./ui/cls.js";

/**
 * One action in the Caches table: a cleanup the tool's own command does.
 *
 * The commands are the server's text for exactly what will run. An action
 * that cannot run here is shown disabled, with the reason in place of its
 * cost. Its size is what the tool reports it would free, or "size unknown".
 *
 * @param {{action: object, checked: boolean,
 *          onChange: (checked: boolean) => void}} props
 */
export default function ActionRow({ action, checked, onChange }) {
  const off = !action.available;
  const risk = riskOf(action);

  return (
    <tr
      className={cls(
        "rule action-row",
        risk === "safe" ? "" : risk,
        off ? "unavailable" : "",
        !off && !checked ? "spared" : "",
      )}
    >
      <td className="grip">
        <Glyph name="command" size={14} label="Runs a command" />
      </td>
      <td>
        <input
          type="checkbox"
          checked={checked && !off}
          disabled={off}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={`Select ${action.label}`}
        />
      </td>
      <td className="risk-cell">
        <RiskBadge risk={risk} note={action.riskNote} />
      </td>
      <td>
        <span className="cache-label">{action.label}</span>
        <span className="cache-cost">{off ? action.reason : action.cost}</span>
      </td>
      <td className="where">
        <ul className="command-list">
          {action.commands.map((command) => (
            <li key={command} className="command" title={command}>
              {command}
            </li>
          ))}
        </ul>
      </td>
      <td className="num">
        {action.bytes === null ? <span className="size-unknown">size unknown</span> : bytes(action.bytes)}
      </td>
      <td className="num" />
    </tr>
  );
}
