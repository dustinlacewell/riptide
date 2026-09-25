import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbort } from "./source/errors.js";

/**
 * One stoppable run at a time.
 *
 *   begin()     aborts any run still going and returns a fresh signal
 *   stop()      aborts the current run
 *   settle(e, signal)
 *               true when e is an abort, so the caller shows no error. Only
 *               the current run's abort marks it stopped: a run replaced by
 *               begin() ends quietly.
 *   stopped     the last run ended by stop()
 *
 * A panel that unmounts takes its run with it.
 */
export function useStoppable() {
  const current = useRef(null);
  const [stopped, setStopped] = useState(false);

  const begin = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setStopped(false);
    return controller.signal;
  }, []);

  const stop = useCallback(() => current.current?.abort(), []);

  const settle = useCallback((err, signal) => {
    if (!isAbort(err)) return false;
    if (signal === current.current?.signal) setStopped(true);
    return true;
  }, []);

  useEffect(() => () => current.current?.abort(), []);

  return useMemo(
    () => ({ begin, stop, settle, stopped }),
    [begin, stop, settle, stopped],
  );
}
