import { clockTime, perSecond } from "./format.js";
import { fractionOf, receiptLine, stepsOf, walkHint } from "./scanStream.js";
import Glyph from "./ui/Glyph.jsx";
import Meter from "./ui/Meter.jsx";
import PhaseDots from "./ui/PhaseDots.jsx";
import Stat from "./ui/Stat.jsx";
import { cls } from "./ui/cls.js";

/**
 * A live read of a scan: which step it is on, how far through the records
 * it is, and how fast. On finish the bar flashes full, then the panel
 * folds to one receipt line.
 *
 * @param {{scan: object, elapsedMs: number, drive?: string}} props
 *   scan is the state from useScanStream; drive names the volume when the
 *   notes do not
 */
export default function ScanTelemetry({ scan, elapsedMs, drive }) {
  if (scan.phase === "idle") return null;

  const walk = scan.strategy === "walk";
  const done = scan.phase === "done";
  const fraction = fractionOf(scan);

  return (
    <section
      className={cls("telemetry", walk && "slow", done && "done")}
      aria-label="Scan progress"
    >
      <div className="telemetry-head">
        <span className="telemetry-title">{titleOf(scan, drive)}</span>
        {done ? <Receipt receipt={scan.receipt} /> : <Steps scan={scan} />}
      </div>

      <div className="telemetry-fold">
        <div className="telemetry-inner">
          <Meter
            thick
            label={walk ? "Folders read" : "Records read"}
            segments={[{ value: fraction ?? 0, tone: walk && !done ? "still" : "current" }]}
            flow={!walk && !done}
            glow={done}
          />
          <Readouts scan={scan} elapsedMs={elapsedMs} walk={walk} />
        </div>
      </div>

      {walk && <p className="telemetry-hint">{walkHint(scan.reason)}</p>}
    </section>
  );
}

function titleOf(scan, drive) {
  if (scan.strategy === "walk") return "directory walk — slow path";
  const where = scan.drive ?? drive;
  const title = where ? `MFT scan · ${where}` : "MFT scan";
  return scan.driveCount > 1 ? `${title} · drive ${scan.driveIndex} of ${scan.driveCount}` : title;
}

function Steps({ scan }) {
  const { steps, current } = stepsOf(scan);
  return (
    <PhaseDots
      steps={steps}
      current={current}
      still={scan.strategy === "walk" && current === 0}
      label="Scan step"
    />
  );
}

function Receipt({ receipt }) {
  return (
    <span className="telemetry-receipt">
      <Glyph name="done" size={14} />
      <span>{receiptLine(receipt)}</span>
    </span>
  );
}

function Readouts({ scan, elapsedMs, walk }) {
  return (
    <div className="telemetry-stats">
      <Stat
        label={walk ? "Folders" : "Records"}
        value={scan.recordsDone.toLocaleString()}
        hint={scan.recordsTotal ? `/ ${scan.recordsTotal.toLocaleString()}` : null}
      />
      <Stat label="Rate" value={perSecond(scan.rate)} />
      <Stat label="Elapsed" value={clockTime(elapsedMs)} />
      {scan.matches !== null && (
        <Stat label="Matches" value={scan.matches.toLocaleString()} dim />
      )}
    </div>
  );
}
