import { cls } from "./cls.js";

/**
 * One readout: a caps label over a mono value.
 *
 *   hint  sits after the value, smaller and dim. It clarifies the value
 *         (a unit, "/ total") and nothing else.
 *   dim   the value is secondary
 */
export default function Stat({ label, value, hint, dim = false }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <div className="stat-line">
        <span className={cls("stat-value", dim && "stat-dim")}>{value}</span>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}
