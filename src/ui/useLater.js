import { useCallback, useEffect, useRef } from "react";

/**
 * later(fn, ms): run fn after ms, unless the component has unmounted by
 * then. For effects that must wait out an animation.
 */
export function useLater() {
  const timers = useRef(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  return useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
}
