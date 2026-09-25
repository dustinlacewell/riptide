import { bytes, bytesParts, unitOf } from "./format.js";
import { shareOf } from "./reclaim.js";
import Meter from "./ui/Meter.jsx";
import { tokenMs } from "./ui/motion.js";
import { useTween } from "./ui/useTween.js";

/**
 * The bytes a selection would free, as a hero figure over a bar of what
 * the scan found: safe share, then caution share.
 *
 * @param {{reclaim: ReturnType<import("./reclaim.js").reclaimOf>,
 *          replayKey?: unknown}} props
 *   replayKey changes when a scan finishes, which rolls the figure up
 *   from 0
 */
export default function ReclaimMeter({ reclaim, replayKey }) {
  const target = Number(reclaim.selected);
  const shown = useTween(target, tokenMs("--t-surge"), replayKey);
  const { value, unit } = bytesParts(shown, unitOf(target));

  return (
    <div className="reclaim-meter">
      <span className="reclaim-label">Selected to reclaim</span>
      <div className="reclaim-hero">
        <span className="reclaim-number">{value}</span>
        <span className="reclaim-unit">{unit}</span>
      </div>
      <Meter
        segments={[
          { value: shareOf(reclaim.safe, reclaim.total), tone: "current" },
          { value: shareOf(reclaim.caution, reclaim.total), tone: "caution" },
        ]}
      />
      <span className="reclaim-of">of {bytes(reclaim.total)} found</span>
    </div>
  );
}
