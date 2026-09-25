import { cls } from "./cls.js";

/**
 * A horizontal bar of one or more segments laid end to end.
 *
 *   segments  [{value: 0..1, tone}] — tone is a token name: current,
 *             still, safe or caution (caution is hatched)
 *   flow      streaks drift through the segments: work is moving
 *   glow      one flash of light around the bar
 *   label     makes it a progressbar with this name; without one it is
 *             decoration and hidden from assistive tech
 */
export default function Meter({ segments, flow = false, glow = false, label, thick = false }) {
  const filled = segments.reduce((sum, s) => sum + clamp(s.value), 0);
  const a11y = label
    ? {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": Math.round(filled * 100),
      }
    : { "aria-hidden": true };

  return (
    <div className={cls("meter", thick && "meter-thick", glow && "meter-glow")} {...a11y}>
      {segments.map((s, i) => (
        <div
          key={i}
          className={cls("meter-seg", `meter-${s.tone}`, flow && "meter-flow")}
          style={{ width: `${clamp(s.value) * 100}%` }}
        />
      ))}
    </div>
  );
}

function clamp(v) {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}
