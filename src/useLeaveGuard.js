import { useEffect } from "react";

/**
 * Ask before the page closes or reloads, while `active` is true.
 *
 * The browser shows its own wording; the page cannot set it.
 *
 * @param {boolean} active
 */
export function useLeaveGuard(active) {
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
