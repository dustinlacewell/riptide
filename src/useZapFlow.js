import { useCallback, useRef, useState } from "react";
import { useClock, useSource } from "./source/context.js";
import {
  applyActionNote,
  applyDeleteNote,
  finishRun,
  removedFromView,
  sizesByPath,
  startRun,
} from "./deleteTally.js";
import { refusedPaths } from "./risk.js";
import { useWipeQueue } from "./useWipeQueue.js";

/**
 * The plan / confirm / delete cycle, shared by the Zap and Caches tabs.
 *
 * Both tabs end at the same place: a set of paths, a confirmation, then a
 * streamed delete. The Caches tab can add actions, which run after the
 * paths. Only the way the paths are found differs, so that part
 * stays in the panels and this holds the rest.
 *
 * While a delete runs, `run` (see deleteTally.js) says which rows are wiping
 * out and which failed. A deleted row gets one --t-base to wipe, then
 * onDeleted drops it.
 *
 * @param {(deletedPaths: string[]) => void} onDeleted lets the panel drop
 *        the rows that actually went
 */
export function useZapFlow(onDeleted) {
  const api = useSource();
  const clock = useClock();
  const [pending, setPending] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  // Paths the server screened out. The screen is fixed, so once refused a
  // path stays refused; each plan adds to the set rather than replacing it.
  const [refused, setRefused] = useState(() => new Set());
  // Held here, not in the dialog: the Zap button beside the table turns red
  // with it, so it outlives a cancelled confirmation.
  const [permanent, setPermanent] = useState(false);
  // Sizes of what the plan was made from, so the run can count bytes freed.
  const sizes = useRef(new Map());

  /**
   * @param {Array<{path: string, bytes: string}>} items
   * @param {string} bytes
   * @param {string[]} [actions] action ids to run after the paths
   */
  const preparePlan = useCallback(async (items, bytes, actions = []) => {
    setError(null);
    setPlanning(true);
    try {
      sizes.current = sizesByPath(items);
      const plan = await api.plan(items.map((i) => i.path), bytes, actions);
      if (plan.refused.length > 0) {
        setRefused((prev) => new Set([...prev, ...refusedPaths(plan.refused)]));
      }
      setPending(plan);
    } catch (e) {
      setError(e.message);
    } finally {
      setPlanning(false);
    }
  }, [api]);

  // Give the row its wipe, then take it out of the table.
  const dropAfterWipe = useWipeQueue(
    useCallback(
      (paths) => {
        onDeleted(paths);
        setRun((r) => r && paths.reduce(removedFromView, r));
      },
      [onDeleted],
    ),
  );

  const confirmZap = useCallback(async () => {
    const plan = pending;
    if (!plan) return;

    setPending(null);
    setError(null);
    setDeleting(true);
    setRun(
      startRun({
        paths: plan.paths,
        sizes: sizes.current,
        permanent,
        t: clock(),
        actions: plan.actions ?? [],
      }),
    );

    try {
      const res = await api.zap({
        token: plan.token,
        permanent,
        confirmCount: plan.count,
        // A scan started meanwhile clears the run; its notes then have
        // nowhere to go.
        onProgress: (note) => {
          if (note.type === "action") {
            setRun((r) => r && applyActionNote(r, note));
            return;
          }
          setRun((r) => r && applyDeleteNote(r, note));
          if (note.ok) dropAfterWipe([note.path]);
        },
      });
      setRun((r) => r && finishRun(r, { t: clock(), elapsedMs: res.elapsedMs }));
      // A row that was never on screen (a closed cache rule) still goes.
      dropAfterWipe(res.deleted);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
      // Permanent is a per-run choice: the next plan starts on the Recycle Bin.
      setPermanent(false);
    }
  }, [api, clock, pending, permanent, dropAfterWipe]);

  return {
    pending,
    planning,
    deleting,
    run,
    error,
    refused,
    permanent,
    setPermanent,
    setError,
    clearRun: () => setRun(null),
    preparePlan,
    confirmZap,
    cancelPlan: () => setPending(null),
  };
}
