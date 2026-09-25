import { useCallback, useRef } from "react";
import { tokenMs } from "./ui/motion.js";
import { useLater } from "./ui/useLater.js";

/**
 * Deleted rows wait out their wipe, then leave together.
 *
 * Each path gets one --t-base to animate. Removal is batched: one timer
 * releases every path whose wipe has finished, so a delete of thousands
 * of paths filters the table a few times a second, not once per path.
 *
 * @param {(paths: string[]) => void} onDrop
 * @returns {(paths: string[]) => void} queue paths that were just deleted
 */
export function useWipeQueue(onDrop) {
  const later = useLater();
  const queue = useRef([]);
  const armed = useRef(false);

  return useCallback(
    (paths) => {
      const wipeMs = tokenMs("--t-base");
      const at = performance.now() + wipeMs;
      for (const path of paths) queue.current.push({ path, at });
      if (armed.current) return;
      armed.current = true;

      const release = () => {
        const now = performance.now();
        const ready = queue.current.filter((q) => q.at <= now).map((q) => q.path);
        queue.current = queue.current.filter((q) => q.at > now);
        if (ready.length > 0) onDrop(ready);

        if (queue.current.length > 0) later(release, queue.current[0].at - now);
        else armed.current = false;
      };
      later(release, wipeMs);
    },
    [later, onDrop],
  );
}
