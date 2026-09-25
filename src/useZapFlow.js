import { useCallback, useState } from "react";
import * as api from "./api.js";
import { refusedPaths } from "./risk.js";

/**
 * The plan / confirm / delete cycle, shared by the Zap and Caches tabs.
 *
 * Both tabs end at the same place: a set of paths, a confirmation, then a
 * streamed delete. Only the way the paths are found differs, so that part
 * stays in the panels and this holds the rest.
 *
 * @param {(deletedPaths: string[]) => void} onDeleted lets the panel drop
 *        the rows that actually went
 */
export function useZapFlow(onDeleted) {
  const [pending, setPending] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [zapping, setZapping] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState(null);
  // Paths the server screened out. The screen is fixed, so once refused a
  // path stays refused; each plan adds to the set rather than replacing it.
  const [refused, setRefused] = useState(() => new Set());
  // Held here, not in the dialog: the Zap button beside the table turns red
  // with it, so it outlives a cancelled confirmation.
  const [permanent, setPermanent] = useState(false);

  const preparePlan = useCallback(async (paths, bytes) => {
    setError(null);
    setPlanning(true);
    try {
      const plan = await api.plan(paths, bytes);
      if (plan.refused.length > 0) {
        setRefused((prev) => new Set([...prev, ...refusedPaths(plan.refused)]));
      }
      setPending(plan);
    } catch (e) {
      setError(e.message);
    } finally {
      setPlanning(false);
    }
  }, []);

  const confirmZap = useCallback(
    async () => {
      const plan = pending;
      if (!plan) return;

      setPending(null);
      setError(null);
      setZapping({ done: 0, total: plan.count, path: "" });

      try {
        const res = await api.zap({
          token: plan.token,
          permanent,
          confirmCount: plan.count,
          onProgress: (n) =>
            setZapping({ done: n.done, total: n.total, path: n.path }),
        });
        setOutcome(res);
        // Only what actually went; a failure stays visible to retry.
        onDeleted(res.deleted);
      } catch (e) {
        setError(e.message);
      } finally {
        setZapping(null);
      }
    },
    [pending, permanent, onDeleted],
  );

  return {
    pending,
    planning,
    zapping,
    outcome,
    error,
    refused,
    permanent,
    setPermanent,
    setError,
    setOutcome,
    preparePlan,
    confirmZap,
    cancelPlan: () => setPending(null),
  };
}
