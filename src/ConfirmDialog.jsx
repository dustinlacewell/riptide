import { useState } from "react";
import { bytes } from "./format.js";
import { useCaps } from "./source/context.js";
import Callout from "./ui/Callout.jsx";
import Dialog from "./ui/Dialog.jsx";
import ZapButton from "./ZapButton.jsx";

/**
 * Final gate before deletion. Requires typing the count, so a stray click
 * cannot delete a list the user never read. The count covers every item:
 * paths and actions.
 *
 * Actions are listed apart from the paths, with the commands they run.
 * The Recycle Bin choice is shown only when there are paths: a command has
 * no Recycle Bin. A source without permanent deletes (the demo) hides it.
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
  const caps = useCaps();
  const [typed, setTyped] = useState("");

  const actions = plan.actions ?? [];
  const pathCount = plan.paths.length;
  const armed = typed.trim() === String(plan.count);

  return (
    <Dialog title={titleOf(pathCount, actions.length, noun, permanent)} onClose={onCancel}>
      {/* An action of unknown size adds nothing, so "0 B" would be false. */}
      {(plan.bytes !== "0" || actions.length === 0) && (
        <p className="dialog-lede">{bytes(plan.bytes)} will be freed.</p>
      )}

      {pathCount > 0 && (
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
      )}

      {actions.length > 0 && pathCount > 0 && (
        <p className="dialog-subhead">Then run {commandsText(actions.length)}</p>
      )}
      {actions.length > 0 && (
        <ul className="preview preview-commands">
          {actions.map((a) => (
            <li key={a.id}>
              <span className="preview-action">{a.label}</span>
              {a.commands.map((c) => (
                <span key={c} className="preview-command" title={c}>
                  {c}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

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

      {plan.refusedActions?.length > 0 && (
        <Callout tone="refused" title={`Not run: ${plan.refusedActions.length} refused`}>
          <ul className="refused-list">
            {plan.refusedActions.map((r) => (
              <li key={r.id}>
                {r.id} <em>({r.reason})</em>
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

      {pathCount > 0 && caps.permanent && (
        <label className="permanent">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => onPermanentChange(e.target.checked)}
          />
          Delete permanently. Skip the Recycle Bin.
        </label>
      )}

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
          count={pathCount}
          noun={noun}
          bytes={plan.bytes}
          commands={actions.length}
          anyCaution={anyCaution}
          permanent={permanent && pathCount > 0}
          disabled={!armed}
          onClick={onConfirm}
        />
      </div>
    </Dialog>
  );
}

function titleOf(pathCount, actionCount, noun, permanent) {
  if (pathCount === 0) return `Run ${commandsText(actionCount)}`;
  const things = pathCount === 1 ? noun[0] : noun[1];
  return permanent
    ? `Delete ${pathCount} ${things} permanently`
    : `Send ${pathCount} ${things} to the Recycle Bin`;
}

function commandsText(n) {
  return `${n} ${n === 1 ? "command" : "commands"}`;
}
