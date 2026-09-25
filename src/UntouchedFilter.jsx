import { UNTOUCHED_CHOICES } from "./stale.js";

/**
 * The Caches view's age filter: a chip that shows only caches whose
 * project has gone untouched for at least the chosen number of days.
 */
export default function UntouchedFilter({ on, days, onToggle, onDays }) {
  return (
    <div className="untouched">
      <button className="pack-chip" aria-pressed={on} onClick={onToggle}>
        Untouched ≥ {days} days
      </button>
      <select
        value={days}
        onChange={(e) => onDays(Number(e.target.value))}
        aria-label="Untouched for at least"
      >
        {UNTOUCHED_CHOICES.map((d) => (
          <option key={d} value={d}>
            {d} d
          </option>
        ))}
      </select>
    </div>
  );
}
