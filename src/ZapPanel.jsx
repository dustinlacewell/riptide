import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api.js";
import { bytes, sumBytes } from "./format.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import HitRow from "./HitRow.jsx";
import ZapStatus from "./ZapStatus.jsx";
import RootField from "./RootField.jsx";
import Callout from "./ui/Callout.jsx";
import SortHeader from "./ui/SortHeader.jsx";
import { riskOf } from "./risk.js";
import { COLUMNS, DEFAULT_SORT, nextSort, sortHits } from "./sort.js";
import { useRowPainter } from "./useRowPainter.js";
import { useStoppable } from "./useStoppable.js";
import { useZapFlow } from "./useZapFlow.js";

/**
 * The Zap tab: find build junk under a root, pick what to keep, delete
 * the rest. Root is owned by App and shared with the Search tab.
 */
export default function ZapPanel({
  root,
  setRoot,
  chooseRoot,
  recentRoots,
  roots,
  prefs,
  onPrefsChange,
  onBusy,
}) {
  const [patterns, setPatterns] = useState(prefs.patterns ?? "node_modules");

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const [spared, setSpared] = useState(() => new Set());
  const [sort, setSort] = useState(prefs.sort ?? DEFAULT_SORT);

  // Drop only what actually went. A failed path stays on the list so it can
  // be retried or investigated.
  const onDeleted = useCallback((deleted) => {
    const gone = new Set(deleted);
    setResult((prev) =>
      prev ? { ...prev, hits: prev.hits.filter((h) => !gone.has(h.path)) } : prev,
    );
  }, []);

  const flow = useZapFlow(onDeleted);
  const run = useStoppable();

  useEffect(() => {
    onPrefsChange({ patterns, sort });
  }, [patterns, sort, onPrefsChange]);

  const hits = useMemo(
    () => sortHits(result?.hits ?? [], sort),
    [result, sort],
  );
  // A refused path never goes into a plan, whatever its checkbox said.
  const selected = useMemo(
    () =>
      hits.filter(
        (h) => !spared.has(h.path) && riskOf(h, flow.refused) !== "refused",
      ),
    [hits, spared, flow.refused],
  );
  const selectedBytes = useMemo(
    () => sumBytes(selected.map((h) => h.bytes)),
    [selected],
  );

  const busy = scanning || flow.planning || flow.zapping !== null;
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  async function runScan() {
    const signal = run.begin();
    setScanning(true);
    flow.setError(null);
    setResult(null);
    flow.setOutcome(null);
    setSpared(new Set());
    setProgress({ stage: "starting" });

    try {
      setResult(
        await api.scan({
          root,
          patterns,
          signal,
          onProgress: (n) => setProgress(n),
        }),
      );
    } catch (e) {
      if (!run.settle(e, signal)) flow.setError(e.message);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  // "spared" holds the unchecked rows, so checking a path means removing it.
  const setChecked = useCallback((paths, checked) => {
    setSpared((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (checked) next.delete(path);
        else next.add(path);
      }
      return next;
    });
  }, []);

  const isChecked = useCallback((path) => !spared.has(path), [spared]);

  const { onPointerDown, onPointerEnter, painting } = useRowPainter(
    setChecked,
    isChecked,
  );

  return (
    <>
      <section className="controls">
        <RootField
          root={root}
          setRoot={setRoot}
          chooseRoot={chooseRoot}
          roots={roots}
          recent={recentRoots}
          placeholder="C:\Users\you"
        />

        <label>
          Folder names
          <input
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
            placeholder="node_modules, dist, target"
            spellCheck={false}
          />
        </label>

        <button className="primary" onClick={runScan} disabled={scanning || !root}>
          {scanning ? "Scanning…" : "Scan"}
        </button>
        {scanning && <button onClick={run.stop}>Stop</button>}
      </section>

      {run.stopped && !scanning && <Callout tone="info">Stopped.</Callout>}

      {progress && (
        <p className="status">
          {progress.stage}
          {progress.recordsDone ? ` — ${progress.recordsDone.toLocaleString()}` : ""}
          {progress.reason ? ` (${progress.reason})` : ""}
        </p>
      )}

      {flow.error && <p className="error">{flow.error}</p>}

      <ZapStatus zapping={flow.zapping} outcome={flow.outcome} />

      {result && (
        <>
          <div className="summary">
            <span>
              <strong>{hits.length}</strong> found
            </span>
            <span>
              <strong>{selected.length}</strong> selected
            </span>
            <span>
              <strong>{bytes(selectedBytes)}</strong> to reclaim
            </span>
            <span className="strategy">
              {result.strategy === "mft" ? "MFT scan" : "directory walk"}
              {" · "}
              {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>

          {result.strategy === "walk" && (
            <Callout tone="info">
              Directory walk
              {/EPERM|EACCES/.test(result.reason ?? "")
                ? " — the MFT scan needs an elevated shell. Run the dev server as administrator for a much faster scan."
                : `: ${result.reason}`}
            </Callout>
          )}

          {hits.length > 0 && (
            <>
              <div className="bulk">
                <button onClick={() => setSpared(new Set())}>Select all</button>
                <button onClick={() => setSpared(new Set(hits.map((h) => h.path)))}>
                  Select none
                </button>
              </div>

              <table className={`hits${painting ? " painting" : ""}`}>
                <thead>
                  <tr>
                    <th />
                    <th />
                    <SortHeader
                      columns={COLUMNS}
                      sort={sort}
                      onSort={(key) => setSort((s) => nextSort(s, key))}
                    />
                  </tr>
                </thead>
                <tbody>
                  {hits.map((hit) => (
                    <HitRow
                      key={hit.path}
                      hit={hit}
                      risk={riskOf(hit, flow.refused)}
                      spared={spared.has(hit.path)}
                      setChecked={setChecked}
                      onPointerDown={onPointerDown}
                      onPointerEnter={onPointerEnter}
                    />
                  ))}
                </tbody>
              </table>

              <button
                className="danger"
                onClick={() =>
                  flow.preparePlan(selected.map((h) => h.path), selectedBytes)
                }
                disabled={
                  selected.length === 0 || flow.zapping !== null || flow.planning
                }
              >
                {flow.planning ? (
                  "Checking…"
                ) : (
                  <>
                    Zap {selected.length}{" "}
                    {selected.length === 1 ? "folder" : "folders"}
                    {" · "}
                    {bytes(selectedBytes)}
                  </>
                )}
              </button>
            </>
          )}

          {hits.length === 0 && <p className="empty">Nothing matched.</p>}
        </>
      )}

      {flow.pending && (
        <ConfirmDialog
          plan={flow.pending}
          onCancel={flow.cancelPlan}
          onConfirm={flow.confirmZap}
        />
      )}
    </>
  );
}
