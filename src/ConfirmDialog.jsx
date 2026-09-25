import { useState } from "react";
import { bytes } from "./format.js";
import Callout from "./ui/Callout.jsx";
import Dialog from "./ui/Dialog.jsx";
import ZapButton from "./ZapButton.jsx";

/**
 * Final gate before deletion. Requires typing the count, so a stray click
 * cannot delete a list the user never read.
 *
 * permanent is owned by the caller: the Zap button outside the dialog
 * shows it too.
 */
export default function ConfirmDialog({
  plan,
  noun,
  anyCaution,
  permanent,
  onPermanentChange,
  onCancel,
  onConfirm,
}) {
  const [typed, setTyped] = useState("");

  const armed = typed.trim() === String(plan.count);
  const things = plan.count === 1 ? noun[0] : noun[1];
  const title = permanent
    ? `Delete ${plan.count} ${things} permanently`
    : `Send ${plan.count} ${things} to the Recycle Bin`;

  return (
    <Dialog title={title} onClose={onCancel}>
      <p className="dialog-lede">{bytes(plan.bytes)} will be freed.</p>

      <ul className="preview">
        {plan.paths.slice(0, 8).map((p) => (
          <li key={p} title={p}>
            {p}
          </li>
        ))}
        {plan.paths.length > 8 && (
          <li className="more">and {plan.paths.length - 8} more…</li>
        )}
      </ul>

      {plan.refused.length > 0 && (
        <Callout tone="refused" title={`Never deleted: ${plan.refused.length} refused`}>
          <ul className="refused-list">
            {plan.refused.map((r) => (
              <li key={r.path} title={r.path}>
                {r.path} <em>({r.reason})</em>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {plan.missing.length > 0 && (
        <Callout tone="info">
          {plan.missing.length} path(s) vanished since the scan and were skipped.
        </Callout>
      )}

      <label className="permanent">
        <input
          type="checkbox"
          checked={permanent}
          onChange={(e) => onPermanentChange(e.target.checked)}
        />
        Delete permanently. Skip the Recycle Bin.
      </label>

      <label className="confirm">
        Type <strong>{plan.count}</strong> to confirm
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          spellCheck={false}
        />
      </label>

      <div className="actions">
        <button onClick={onCancel}>Cancel</button>
        <ZapButton
          count={plan.count}
          noun={noun}
          bytes={plan.bytes}
          anyCaution={anyCaution}
          permanent={permanent}
          disabled={!armed}
          onClick={onConfirm}
        />
      </div>
    </Dialog>
  );
}
