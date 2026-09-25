import { useEffect, useId, useRef, useState } from "react";
import { FOCUSABLE, trapTarget } from "./focusTrap.js";

/**
 * A modal dialog: backdrop, title, and focus handling.
 *
 * Esc and a click on the backdrop both call onClose. Focus moves into the
 * dialog on open — to a child that took it with autoFocus, else the dialog
 * itself — and returns to whatever had it before on close. Tab and
 * Shift+Tab cycle inside the dialog and never reach the page behind it.
 *
 * onKeyDown sees every other key pressed inside the dialog.
 */
export default function Dialog({ title, onClose, onKeyDown, className, children }) {
  const titleId = useId();
  const box = useRef(null);
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    const dialog = box.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    // Only a real close hands focus back. StrictMode's rehearsal unmount
    // leaves the node in the page, and must not pull focus out of it.
    return () => {
      if (dialog && !dialog.isConnected) opener?.focus?.();
    };
  }, [opener]);

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      keepFocusInside(e, box.current);
      return;
    }
    onKeyDown?.(e);
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        ref={box}
        className={className ? `dialog ${className}` : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** Tab past either end of the dialog wraps to the other end. */
function keepFocusInside(e, dialog) {
  const stops = [...dialog.querySelectorAll(FOCUSABLE)];
  const target = trapTarget(stops.length, stops.indexOf(document.activeElement), e.shiftKey);
  if (target === null) return;
  e.preventDefault();
  (stops[target] ?? dialog).focus();
}
