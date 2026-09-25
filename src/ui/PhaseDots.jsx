import { cls } from "./cls.js";

/**
 * Named steps in a row, each with a dot: past steps lit, the current one
 * pulsing, later ones dark.
 *
 *   current  index of the step in progress; -1 for none
 *   still    the current step holds a lit dot that does not pulse
 */
export default function PhaseDots({ steps, current, still = false, label = "Progress" }) {
  return (
    <ol className="phase-dots" aria-label={label}>
      {steps.map((step, i) => (
        <li
          key={step}
          className={cls(
            "phase",
            i < current && "past",
            i === current && (still ? "still" : "on"),
          )}
          aria-current={i === current ? "step" : undefined}
        >
          <span className="phase-dot" />
          <span className="phase-label">{step}</span>
          {i < steps.length - 1 && (
            <span className="phase-arrow" aria-hidden="true">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
