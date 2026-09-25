import { runReceiptLine } from "./deleteTally.js";
import { bytesParts, unitOf } from "./format.js";
import Glyph from "./ui/Glyph.jsx";
import Meter from "./ui/Meter.jsx";
import Stat from "./ui/Stat.jsx";
import { tokenMs } from "./ui/motion.js";
import { useTween } from "./ui/useTween.js";

/**
 * A delete in progress, then its receipt. Shared by the Zap and Caches
 * tabs.
 *
 * @param {{run: object|null, noun: [string, string]}} props
 *   run is the state from deleteTally.js
 */
export default function DeleteRun({ run, noun }) {
  if (!run) return null;
  if (run.receipt) return <Receipt run={run} noun={noun} />;

  return (
    <section className="delete-run" aria-label="Delete progress">
      <span className="delete-title">
        {run.permanent ? "Deleting permanently" : "Sending to the Recycle Bin"}
      </span>
      <Meter
        thick
        flow
        label="Deleted"
        segments={[{ value: run.total ? run.done / run.total : 0, tone: "current" }]}
      />
      <div className="delete-stats">
        <Freed bytes={run.freed} />
        <Stat
          label={noun[1]}
          value={run.done.toLocaleString()}
          hint={`/ ${run.total.toLocaleString()}`}
        />
      </div>
    </section>
  );
}

/** Bytes freed so far, counting up as each path goes. */
function Freed({ bytes }) {
  const target = Number(bytes);
  const shown = useTween(target, tokenMs("--t-base"));
  const { value, unit } = bytesParts(shown, unitOf(target));
  return <Stat label="Freed" value={value} hint={unit} />;
}

function Receipt({ run, noun }) {
  const { receipt } = run;
  return (
    <section className="delete-receipt" role="status">
      <p className="delete-receipt-line">
        <Glyph name="done" size={24} />
        <span>{runReceiptLine(receipt, noun)}</span>
      </p>
      <p className="delete-receipt-note">
        {run.permanent ? "Deleted permanently." : "In the Recycle Bin. Restore them from there."}
      </p>
      {receipt.failed > 0 && (
        <p className="delete-receipt-failed">
          <Glyph name="failed" size={12} />
          {receipt.failed.toLocaleString()} failed. They stay in the list with the reason.
        </p>
      )}
    </section>
  );
}
