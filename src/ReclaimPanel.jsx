import ReclaimMeter from "./ReclaimMeter.jsx";
import ZapButton from "./ZapButton.jsx";

/**
 * The side column beside a results table: what the selection frees, any
 * warnings the panel passes in, and the Zap button with where the files go.
 *
 * @param {{reclaim: object, replayKey?: unknown, noun: [string, string],
 *          permanent: boolean, busy: boolean, disabled: boolean,
 *          onZap: () => void, children?: React.ReactNode}} props
 */
export default function ReclaimPanel({
  reclaim,
  replayKey,
  noun,
  permanent,
  busy,
  disabled,
  onZap,
  children,
}) {
  return (
    <aside className="reclaim" aria-label="Reclaim">
      <ReclaimMeter reclaim={reclaim} replayKey={replayKey} />
      {children}
      <ZapButton
        count={reclaim.count}
        noun={noun}
        bytes={reclaim.selected}
        anyCaution={reclaim.anyCaution}
        permanent={permanent}
        busy={busy}
        disabled={disabled || reclaim.count === 0}
        onClick={onZap}
      />
      <span className={permanent ? "reclaim-dest permanent" : "reclaim-dest"}>
        {permanent ? "Deletes permanently" : "Sends to the Recycle Bin"}
      </span>
    </aside>
  );
}
