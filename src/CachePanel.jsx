import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api.js";
import { bytes, sumBytes } from "./format.js";
import { riskOf } from "./risk.js";
import CacheRuleRows from "./CacheRuleRows.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import ZapStatus from "./ZapStatus.jsx";
import CacheSettings from "./CacheSettings.jsx";
import RootField from "./RootField.jsx";
import Callout from "./ui/Callout.jsx";
import Glyph from "./ui/Glyph.jsx";
import SortHeader from "./ui/SortHeader.jsx";
import { useStoppable } from "./useStoppable.js";
import { useZapFlow } from "./useZapFlow.js";
import { useRowPainter } from "./useRowPainter.js";
import { CACHE_GROUP_COLUMNS, DEFAULT_SORT, nextSort } from "./sort.js";
import { groupHits, sortGroups } from "./group.js";

/**
 * The Caches tab: known tool caches, found by path rather than by search.
 *
 * Locations come from JSON packs in packs/ — pure data, no commands — so a
 * pack can be shared by sending the file. Sizes come from the MFT, which is
 * why the dev server runs elevated.
 */
export default function CachePanel({
  root,
  setRoot,
  chooseRoot,
  recentRoots,
  roots,
  prefs,
  onPrefsChange,
  onBusy,
}) {
  // prefs.disabledCaches is a fresh array each render, so scan would be
  // rebuilt every time if it depended on the array itself. The joined key is
  // stable for the same set of ids.
  const disabledKey = (prefs.disabledCaches ?? []).join(",");
  const disabled = useMemo(
    () => (disabledKey ? disabledKey.split(",") : []),
    [disabledKey],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [arrived, setArrived] = useState([]);
  const [packs, setPacks] = useState([]);
  const [problems, setProblems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [spared, setSpared] = useState(() => new Set());
  // Which rules are showing their instances. Local and deliberately not
  // persisted: a new scan starts collapsed.
  const [opened, setOpened] = useState(() => new Set());

  const toggleOpen = useCallback((id) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onDeleted = useCallback((deleted) => {
    const gone = new Set(deleted.map((p) => p.toLowerCase()));
    setArrived((prev) => prev.filter((c) => !gone.has(c.path.toLowerCase())));
  }, []);

  const flow = useZapFlow(onDeleted);
  const run = useStoppable();

  const busy = loading || flow.planning || flow.zapping !== null;
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const scan = useCallback(async () => {
    const signal = run.begin();
    setLoading(true);
    flow.setError(null);
    flow.setOutcome(null);
    setSummary(null);
    setProgress({ stage: "starting" });

    setArrived([]);

    try {
      const done = await api.caches({ disabled, root }, (note) => {
        if (note.type === "found") {
          // One message per drive, already sized. Append rather than replace:
          // a later drive adds to the list, it does not supersede it.
          setPacks(note.packs ?? []);
          setArrived((prev) => [...prev, ...note.found]);
          // Nothing is pre-selected: these are not obviously disposable the
          // way a node_modules is, and several carry a caution.
          setSpared((prev) => {
            const next = new Set(prev);
            for (const c of note.found) next.add(c.path);
            return next;
          });
          return;
        }

        setProgress(note);
      }, signal);

      setProblems(done.errors ?? []);
      setSummary(done);
      if (done.failure) flow.setError(done.failure);
    } catch (e) {
      // A stop keeps the drives that already reported.
      if (!run.settle(e, signal)) flow.setError(e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [flow, run, disabled, root]);

  // Grouping and sorting happen at render, not on arrival, so re-sorting
  // never has to wait for another scan.
  const rules = useMemo(
    () => sortGroups(groupHits(arrived), sort),
    [arrived, sort],
  );

  // The flat list stays the source of truth for the summary, the bulk
  // buttons and the zap plan; only the table is grouped.
  const found = arrived;

  // A refused path never goes into a plan, whatever its checkbox said.
  const selected = useMemo(
    () =>
      found.filter(
        (c) => !spared.has(c.path) && riskOf(c, flow.refused) !== "refused",
      ),
    [found, spared, flow.refused],
  );
  const selectedBytes = useMemo(
    () => sumBytes(selected.map((c) => c.bytes)),
    [selected],
  );
  const totalBytes = useMemo(
    () => sumBytes(found.map((c) => c.bytes)),
    [found],
  );

  const setChecked = useCallback((paths, checked) => {
    setSpared((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (checked) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  }, []);

  const isChecked = useCallback((p) => !spared.has(p), [spared]);
  const { onPointerDown, onPointerEnter, painting } = useRowPainter(
    setChecked,
    isChecked,
  );

  // One line per rule, not per instance: a per-project rule with a caution
  // would otherwise repeat the same warning a thousand times.
  const cautions = useMemo(() => {
    const byId = new Map();
    for (const c of selected) {
      if (riskOf(c) === "caution" && !byId.has(c.id)) byId.set(c.id, c);
    }
    return [...byId.values()];
  }, [selected]);

  // One file per cache means 32 packs; group them by ecosystem so the header
  // reads as five chips rather than thirty-two.
  const groups = useMemo(() => {
    const counts = new Map();
    for (const pack of packs) {
      counts.set(pack.name, (counts.get(pack.name) ?? 0) + pack.count);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [packs]);

  return (
    <>
      <section className="controls">
        <RootField
          root={root}
          setRoot={setRoot}
          chooseRoot={chooseRoot}
          roots={roots}
          recent={recentRoots}
          placeholder="D:\code"
        />

        <div className="pack-summary">
          {groups.map(([name, count]) => (
            <span key={name} className="pack-chip">
              {name} · {count}
            </span>
          ))}
        </div>

        <button
          className="cog"
          onClick={() => setSettingsOpen(true)}
          title="Cache configs"
          aria-label="Cache configs"
        >
          <Glyph name="cog" size={20} />
        </button>

        <button className="primary" onClick={scan} disabled={loading}>
          {loading ? "Looking…" : summary ? "Rescan" : "Find caches"}
        </button>
        {loading && <button onClick={run.stop}>Stop</button>}
      </section>

      {run.stopped && !loading && <Callout tone="info">Stopped.</Callout>}

      {!summary && !loading && !run.stopped && (
        <Callout tone="info">
          Searches under the root only. Reads that drive's MFT, so expect a
          minute or two.
        </Callout>
      )}

      {progress && (
        <p className="status">
          {progress.drive
            ? `Reading ${progress.drive} MFT${
                progress.driveCount > 1
                  ? ` (${progress.driveIndex} of ${progress.driveCount})`
                  : ""
              }`
            : progress.stage}
          {progress.count ? ` — ${progress.count.toLocaleString()} records` : ""}
        </p>
      )}

      {flow.error && <p className="error">{flow.error}</p>}

      {problems.length > 0 && (
        <Callout tone="info">
          <details className="problems">
            <summary>{problems.length} pack issues</summary>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        </Callout>
      )}

      <ZapStatus zapping={flow.zapping} outcome={flow.outcome} />

      {found.length > 0 && (
        <>
          <div className="summary">
            <span>
              <strong>{rules.length}</strong>{" "}
              {rules.length === 1 ? "cache" : "caches"}
            </span>
            <span>
              <strong>{found.length.toLocaleString()}</strong> found
            </span>
            <span>
              <strong>{selected.length.toLocaleString()}</strong> selected
            </span>
            <span>
              <strong>{bytes(selectedBytes)}</strong> to reclaim
            </span>
            <span className="strategy">{bytes(totalBytes)} total</span>
          </div>

          <div className="bulk">
            <button onClick={() => setSpared(new Set())}>Select all</button>
            <button onClick={() => setSpared(new Set(found.map((c) => c.path)))}>
              Select none
            </button>
          </div>

          <table className={`hits caches${painting ? " painting" : ""}`}>
            <thead>
              <tr>
                <th />
                <th />
                <th className="plain">Risk</th>
                <SortHeader
                  columns={CACHE_GROUP_COLUMNS}
                  sort={sort}
                  onSort={(key) => setSort((s) => nextSort(s, key))}
                />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <CacheRuleRows
                  key={rule.id}
                  rule={rule}
                  refused={flow.refused}
                  open={opened.has(rule.id)}
                  onToggle={toggleOpen}
                  spared={spared}
                  setChecked={setChecked}
                  onPointerDown={onPointerDown}
                  onPointerEnter={onPointerEnter}
                />
              ))}
            </tbody>
          </table>

          {cautions.length > 0 && (
            <Callout tone="caution" title="Read before deleting">
              <ul>
                {cautions.map((c) => (
                  <li key={c.path}>
                    <strong>{c.label}</strong> — {c.riskNote}
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          <button
            className="danger"
            onClick={() => flow.preparePlan(selected.map((c) => c.path), selectedBytes)}
            disabled={selected.length === 0 || flow.zapping !== null || flow.planning}
          >
            {flow.planning ? (
              "Checking…"
            ) : (
              <>
                Zap {selected.length.toLocaleString()}{" "}
                {selected.length === 1 ? "location" : "locations"} ·{" "}
                {bytes(selectedBytes)}
              </>
            )}
          </button>
        </>
      )}

      {summary && found.length === 0 && (
        <p className="empty">No known caches found on this machine.</p>
      )}

      {settingsOpen && (
        <CacheSettings
          disabled={disabled}
          onChange={(ids) => onPrefsChange({ disabledCaches: ids })}
          onClose={() => setSettingsOpen(false)}
        />
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
