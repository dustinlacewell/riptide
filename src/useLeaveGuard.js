import { useEffect } from "react";
import { useCaps } from "./source/context.js";

/**
 * Ask before the page closes or reloads, while `active` is true. A source
 * whose runs cannot hurt anything (the demo) never asks.
 *
 * The browser shows its own wording; the page cannot set it.
 *
 * @param {boolean} wanted
 */
export function useLeaveGuard(wanted) {
  const { leaveGuard } = useCaps();
  const active = wanted && leaveGuard;
  useEffect(() => {
    if (!active) return undefined;
    const hold = (e) => {
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [active]);
}
