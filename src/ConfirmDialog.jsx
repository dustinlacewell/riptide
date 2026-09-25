import { useState } from "react";
import { bytes } from "./format.js";
import Callout from "./ui/Callout.jsx";
import Dialog from "./ui/Dialog.jsx";

/**
 * Final gate before deletion. Requires typing the count, so a stray click
 * cannot delete a list the user never read.
 */
export default function ConfirmDialog({ plan, onCancel, onConfirm }) {
  const [typed, setTyped] = useState("");
  const [permanent, setPermanent] = useState(false);

  const armed = typed.trim() === String(plan.count);

  return (
    <Dialog title={`Zap ${plan.count} folders?`} onClose={onCancel}>
      <p className="reclaim">{bytes(plan.bytes)} will be freed.</p>

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
          onChange={(e) => setPermanent(e.target.checked)}
        />
        Delete permanently (skip the Recycle Bin — cannot be undone)
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
        <button
          className="danger"
          disabled={!armed}
          onClick={() => onConfirm(permanent)}
        >
          {permanent ? "Delete permanently" : "Move to Recycle Bin"}
        </button>
      </div>
    </Dialog>
  );
}
