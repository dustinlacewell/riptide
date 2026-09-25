import { useEffect, useMemo, useReducer, useState } from "react";
import { IDLE, scanReducer } from "./scanStream.js";

const TICK_MS = 100;
const defaultClock = () => performance.now();

/**
 * Scan telemetry for one panel: the reducer in scanStream.js plus a
 * running elapsed time.
 *
 *   start()        a new run
 *   note(n)        one progress note from the server
 *   finish(done)   the run ended: {strategy?, stats?, elapsedMs?}
 *   reset()        back to nothing shown (a stop or a failure)
 *
 * @param {() => number} [clock] milliseconds; injected so a caller can
 *        drive time itself
 */
export function useScanStream(clock = defaultClock) {
  const [state, dispatch] = useReducer(scanReducer, IDLE);
  const [now, setNow] = useState(0);

  const running = state.phase !== "idle" && state.phase !== "done";
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(clock()), TICK_MS);
    return () => clearInterval(id);
  }, [running, clock]);

  const actions = useMemo(
    () => ({
      start: () => {
        const t = clock();
        setNow(t);
        dispatch({ type: "start", t });
      },
      note: (note) => dispatch({ type: "note", note, t: clock() }),
      finish: (done = {}) => dispatch({ type: "finish", t: clock(), ...done }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [clock],
  );

  const end = state.finishedAt ?? now;
  const elapsedMs = state.startedAt === null ? 0 : Math.max(0, end - state.startedAt);

  return { ...actions, state, elapsedMs };
}
