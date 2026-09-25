import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api.js";
import { bytes, sumBytes, when } from "./format.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import RootField from "./RootField.jsx";
import { COLUMNS, DEFAULT_SORT, nextSort, sortHits } from "./sort.js";
import { useRowPainter } from "./useRowPainter.js";

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
}) {
  const [patterns, setPatterns] = useState(prefs.patterns ?? "node_modules");

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [spared, setSpared] = useState(() => new Set());
  const [pending, setPending] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [sort, setSort] = useState(prefs.sort ?? DEFAULT_SORT);
  const [zapping, setZapping] = useState(null);
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    onPrefsChange({ patterns, sort });
  }, [patterns, sort, onPrefsChange]);

  const hits = useMemo(
    () => sortHits(result?.hits ?? [], sort),
    [result, sort],
  );
  const selected = useMemo(
    () => hits.filter((h) => !spared.has(h.path)),
    [hits, spared],
  );
  const selectedBytes = useMemo(
    () => sumBytes(selected.map((h) => h.bytes)),
    [selected],
  );

  async function runScan() {
    setScanning(true);
    setError(null);
    setResult(null);
    setOutcome(null);
    setSpared(new Set());
    setProgress({ stage: "starting" });

    try {
      setResult(
        await api.scan({ root, patterns, onProgress: (n) => setProgress(n) }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  async function preparePlan() {
    setError(null);
    setPlanning(true);
    try {
      setPending(await api.plan(selected.map((h) => h.path), selectedBytes));
    } catch (e) {
      setError(e.message);
    } finally {
      setPlanning(false);
    }
  }

  async function confirmZap(permanent) {
    const plan = pending;
    setPending(null);
    setError(null);
    setZapping({ done: 0, total: plan.count, path: "" });

    try {
      const res = await api.zap({
        token: plan.token,
        permanent,
        confirmCount: plan.count,
        onProgress: (n) => setZapping({ done: n.done, total: n.total, path: n.path }),
      });

      setOutcome(res);

      // Drop only what actually went. A failed path stays on the list so it
      // can be retried or investigated.
      const gone = new Set(res.deleted);
      setResult((prev) =>
        prev ? { ...prev, hits: prev.hits.filter((h) => !gone.has(h.path)) } : prev,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setZapping(null);
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
      </section>

      {progress && (
        <p className="status">
          {progress.stage}
          {progress.count ? ` — ${progress.count.toLocaleString()}` : ""}
          {progress.reason ? ` (${progress.reason})` : ""}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {zapping && (
        <div className="zapping">
          <div className="bar">
            <div
              className="fill"
              style={{ width: `${(zapping.done / zapping.total) * 100}%` }}
            />
          </div>
          <p className="status">
            Deleting {zapping.done} of {zapping.total}
            {zapping.path && <span className="current"> — {zapping.path}</span>}
          </p>
        </div>
      )}

      {outcome && (
        <div className="outcome">
          <p>
            Zapped {outcome.deleted.length}{" "}
            {outcome.deleted.length === 1 ? "folder" : "folders"}
            {outcome.permanent ? " permanently" : " to the Recycle Bin"} in{" "}
            {(outcome.elapsedMs / 1000).toFixed(1)}s.
          </p>
          {outcome.failed.length > 0 && (
            <ul className="failures">
              {outcome.failed.map((f) => (
                <li key={f.path}>
                  {f.path} — <em>{f.error}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
            <p className="note">
              Directory walk
              {/EPERM|EACCES/.test(result.reason ?? "")
                ? " — the MFT scan needs an elevated shell. Run the dev server as administrator for a much faster scan."
                : `: ${result.reason}`}
            </p>
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
                    {Object.entries(COLUMNS).map(([key, col]) => (
                      <th
                        key={key}
                        className={col.align === "right" ? "num" : undefined}
                        aria-sort={
                          sort.key === key
                            ? sort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          className={`sort${sort.key === key ? " active" : ""}`}
                          onClick={() => setSort((s) => nextSort(s, key))}
                        >
                          {col.label}
                          <span className="arrow">
                            {sort.key === key
                              ? sort.direction === "asc"
                                ? "▲"
                                : "▼"
                              : ""}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hits.map((hit) => (
                    <tr
                      key={hit.path}
                      className={spared.has(hit.path) ? "spared" : ""}
                      onPointerDown={(e) => onPointerDown(e, hit.path)}
                      onPointerEnter={() => onPointerEnter(hit.path)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={!spared.has(hit.path)}
                          onChange={(e) => setChecked([hit.path], e.target.checked)}
                        />
                      </td>
                      <td className="path" title={hit.path}>
                        {hit.path}
                      </td>
                      <td className="num">{bytes(hit.bytes)}</td>
                      <td className="num">{hit.files.toLocaleString()}</td>
                      <td className="num">{when(hit.mtime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                className="danger"
                onClick={preparePlan}
                disabled={selected.length === 0 || zapping !== null || planning}
              >
                {planning ? (
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

      {pending && (
        <ConfirmDialog
          plan={pending}
          onCancel={() => setPending(null)}
          onConfirm={confirmZap}
        />
      )}
    </>
  );
}
