import { runReceiptLine } from "./deleteTally.js";
import { bytesParts, unitOf } from "./format.js";
import Glyph from "./ui/Glyph.jsx";
import Meter from "./ui/Meter.jsx";
import Stat from "./ui/Stat.jsx";
import { tokenMs } from "./ui/motion.js";
import { useTween } from "./ui/useTween.js";

/**
 * A delete in progress, then its receipt. Shared by the Zap and Caches
 * tabs. A run from the Caches tab may also hold actions; each shows its
 * latest output line while it runs, then whether it worked.
 *
 * @param {{run: object|null, noun: [string, string]}} props
 *   run is the state from deleteTally.js
 */
export default function DeleteRun({ run, noun }) {
  if (!run) return null;
  if (run.receipt) return <Receipt run={run} noun={noun} />;

  const hasPaths = run.total > 0;
  return (
    <section className="delete-run" aria-label="Delete progress">
      <span className="delete-title">{titleOf(run)}</span>
      {hasPaths && (
        <>
          <Meter
            thick
            flow
            label="Deleted"
            segments={[{ value: run.done / run.total, tone: "current" }]}
          />
          <div className="delete-stats">
            <Freed bytes={run.freed} />
            <Stat
              label={noun[1]}
              value={run.done.toLocaleString()}
              hint={`/ ${run.total.toLocaleString()}`}
            />
          </div>
        </>
      )}
      <ActionRuns actions={run.actions} />
    </section>
  );
}

function titleOf(run) {
  if (run.total === 0) return "Running commands";
  return run.permanent ? "Deleting permanently" : "Sending to the Recycle Bin";
}

/** Bytes freed so far, counting up as each path goes. */
function Freed({ bytes }) {
  const target = Number(bytes);
  const shown = useTween(target, tokenMs("--t-base"));
  const { value, unit } = bytesParts(shown, unitOf(target));
  return <Stat label="Freed" value={value} hint={unit} />;
}

const STATUS = { waiting: "Waiting", running: "Running", ok: "Done", failed: "Failed" };

/** Each action: its status, and the last line its command printed. */
function ActionRuns({ actions }) {
  if (actions.length === 0) return null;
  return (
    <ul className="action-runs">
      {actions.map((a) => (
        <li key={a.id} className={`action-run action-${a.status}`}>
          <span className="action-run-head">
            <Glyph name={a.status === "ok" ? "done" : a.status === "failed" ? "failed" : "command"} size={12} />
            <span className="action-run-label">{a.label}</span>
            <span className="action-run-status">
              {a.status === "failed" && a.error ? `${STATUS.failed}: ${a.error}` : STATUS[a.status]}
            </span>
          </span>
          {a.line && (
            <span className="action-run-line" title={a.line}>
              {a.line}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Receipt({ run, noun }) {
  const { receipt } = run;
  return (
    <section className="delete-receipt" role="status">
      {run.total > 0 && (
        <>
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
        </>
      )}
      <ActionRuns actions={run.actions} />
    </section>
  );
}
