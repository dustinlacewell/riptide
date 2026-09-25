import { useCallback, useEffect, useMemo, useState } from "react";
import { useSource } from "./source/context.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import HitRow from "./HitRow.jsx";
import DeleteRun from "./DeleteRun.jsx";
import FullRescan from "./FullRescan.jsx";
import ReclaimPanel from "./ReclaimPanel.jsx";
import { fateOf } from "./deleteTally.js";
import { pathKey } from "./pathKey.js";
import RootField from "./RootField.jsx";
import ScanTelemetry from "./ScanTelemetry.jsx";
import { reclaimOf } from "./reclaim.js";
import { enterDelay } from "./rowEnter.js";
import { useScanStream } from "./useScanStream.js";
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
  const api = useSource();
  const [patterns, setPatterns] = useState(prefs.patterns ?? "node_modules");

  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const telemetry = useScanStream();

  const [spared, setSpared] = useState(() => new Set());
  const [sort, setSort] = useState(prefs.sort ?? DEFAULT_SORT);

  // Drop only what actually went. A failed path stays on the list so it can
  // be retried or investigated.
  const onDeleted = useCallback((deleted) => {
    const gone = new Set(deleted.map(pathKey));
    setResult((prev) =>
      prev ? { ...prev, hits: prev.hits.filter((h) => !gone.has(pathKey(h.path))) } : prev,
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
  const reclaim = useMemo(() => reclaimOf(selected, hits), [selected, hits]);

  const busy = scanning || flow.planning || flow.deleting;
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  async function runScan({ full = false } = {}) {
    const signal = run.begin();
    setScanning(true);
    flow.setError(null);
    setResult(null);
    flow.clearRun();
    setSpared(new Set());
    telemetry.start();

    try {
      const found = await api.scan({ root, patterns, full, signal, onProgress: telemetry.note });
      telemetry.finish({
        strategy: found.strategy,
        stats: found.stats,
        elapsedMs: found.elapsedMs,
      });
      setResult(found);
    } catch (e) {
      telemetry.reset();
      if (!run.settle(e, signal)) flow.setError(e.message);
    } finally {
      setScanning(false);
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

        <button className="primary" onClick={() => runScan()} disabled={scanning || !root}>
          {scanning ? "Scanning…" : "Scan"}
        </button>
        <FullRescan onClick={() => runScan({ full: true })} disabled={scanning || !root} />
        {scanning && <button onClick={run.stop}>Stop</button>}
      </section>

      {run.stopped && !scanning && <Callout tone="info">Stopped.</Callout>}

      <ScanTelemetry
        scan={telemetry.state}
        elapsedMs={telemetry.elapsedMs}
        drive={driveOf(root)}
      />

      {flow.error && <p className="error">{flow.error}</p>}

      <DeleteRun run={flow.run} noun={NOUN} />

      {result && hits.length > 0 && (
        <div className="results">
          <div className="results-main">
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
                {hits.map((hit, i) => (
                  <HitRow
                    key={hit.path}
                    hit={hit}
                    risk={riskOf(hit, flow.refused)}
                    spared={spared.has(hit.path)}
                    fate={fateOf(flow.run, hit.path)}
                    enterDelay={enterDelay(i)}
                    setChecked={setChecked}
                    onPointerDown={onPointerDown}
                    onPointerEnter={onPointerEnter}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <ReclaimPanel
            reclaim={reclaim}
            replayKey={telemetry.state.finishedAt}
            noun={NOUN}
            permanent={flow.permanent}
            busy={flow.planning}
            disabled={flow.deleting}
            onZap={() => flow.preparePlan(selected, reclaim.selected)}
          />
        </div>
      )}

      {result && hits.length === 0 && <p className="empty">Nothing matched.</p>}

      {flow.pending && (
        <ConfirmDialog
          plan={flow.pending}
          noun={NOUN}
          anyCaution={reclaim.anyCaution}
          permanent={flow.permanent}
          onPermanentChange={flow.setPermanent}
          onCancel={flow.cancelPlan}
          onConfirm={flow.confirmZap}
        />
      )}
    </>
  );
}

const NOUN = ["folder", "folders"];

/** "D:" from "d:\code", for the telemetry title; null for a UNC root. */
function driveOf(root) {
  return /^[A-Za-z]:/.exec(root ?? "")?.[0].toUpperCase() ?? null;
}
