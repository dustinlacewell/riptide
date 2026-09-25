import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api.js";
import { reclaimOf } from "./reclaim.js";
import { riskOf } from "./risk.js";
import { enterDelay } from "./rowEnter.js";
import ActionRow from "./ActionRow.jsx";
import CacheRuleRows from "./CacheRuleRows.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import DeleteRun from "./DeleteRun.jsx";
import CacheSettings from "./CacheSettings.jsx";
import { fateOf } from "./deleteTally.js";
import { pathKey } from "./pathKey.js";
import ReclaimPanel from "./ReclaimPanel.jsx";
import RootField from "./RootField.jsx";
import ScanTelemetry from "./ScanTelemetry.jsx";
import { useScanStream } from "./useScanStream.js";
import Callout from "./ui/Callout.jsx";
import Glyph from "./ui/Glyph.jsx";
import SortHeader from "./ui/SortHeader.jsx";
import { useStoppable } from "./useStoppable.js";
import { useZapFlow } from "./useZapFlow.js";
import { useRowPainter } from "./useRowPainter.js";
import { CACHE_GROUP_COLUMNS, DEFAULT_SORT, nextSort } from "./sort.js";
import { groupHits, sortGroups } from "./group.js";
import { DEFAULT_UNTOUCHED, untouchedFor } from "./stale.js";
import UntouchedFilter from "./UntouchedFilter.jsx";

const NOUN = ["location", "locations"];

/**
 * The Caches tab: known tool caches, found by path rather than by search.
 *
 * Locations come from JSON packs in packs/ — pure data, no commands — so a
 * pack can be shared by sending the file. Sizes come from the MFT, which is
 * why the dev server runs elevated.
 *
 * A pack entry may instead link an action: a cleanup the tool's own command
 * does (pnpm store prune, docker builder prune). Those list after the
 * caches, and run after the paths are deleted.
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
  const telemetry = useScanStream();
  const [spared, setSpared] = useState(() => new Set());
  // Which rules are showing their instances. Local and deliberately not
  // persisted: a new scan starts collapsed.
  const [opened, setOpened] = useState(() => new Set());
  const [scannedAt, setScannedAt] = useState(0);
  const [untouched, setUntouched] = useState({ on: false, days: DEFAULT_UNTOUCHED });
  // Actions the scan listed, and the ids of the ones picked. Nothing is
  // picked by default, and Select all leaves them alone: each runs a
  // command, so each is chosen on its own.
  const [actions, setActions] = useState([]);
  const [pickedIds, setPickedIds] = useState(() => new Set());

  const toggleOpen = useCallback((id) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onDeleted = useCallback((deleted) => {
    const gone = new Set(deleted.map(pathKey));
    setArrived((prev) => prev.filter((c) => !gone.has(pathKey(c.path))));
  }, []);

  const flow = useZapFlow(onDeleted);
  const run = useStoppable();

  const busy = loading || flow.planning || flow.deleting;
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const scan = useCallback(async () => {
    const signal = run.begin();
    setLoading(true);
    flow.setError(null);
    flow.clearRun();
    setSummary(null);
    telemetry.start();

    setArrived([]);
    setActions([]);
    setPickedIds(new Set());
    // Project ages are read against the scan, not against each render.
    setScannedAt(Date.now());

    try {
      const done = await api.caches({ disabled, root }, (note) => {
        if (note.type === "actions") {
          setPacks(note.packs ?? []);
          setActions(note.actions);
          return;
        }
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

        telemetry.note(note);
      }, signal);

      setProblems(done.errors ?? []);
      setSummary(done);
      if (done.failure) {
        telemetry.reset();
        flow.setError(done.failure);
      } else {
        telemetry.finish({ strategy: "mft", elapsedMs: done.elapsedMs });
      }
    } catch (e) {
      // A stop keeps the drives that already reported.
      telemetry.reset();
      if (!run.settle(e, signal)) flow.setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [flow, run, telemetry, disabled, root]);

  // The Untouched filter narrows everything below it — table, bulk buttons,
  // summary and zap plan — so a hidden row can never be deleted unseen.
  const found = useMemo(
    () => (untouched.on ? untouchedFor(arrived, untouched.days, scannedAt) : arrived),
    [arrived, untouched, scannedAt],
  );

  // Grouping and sorting happen at render, not on arrival, so re-sorting
  // never has to wait for another scan.
  const rules = useMemo(
    () => sortGroups(groupHits(found), sort),
    [found, sort],
  );

  const toggleUntouched = useCallback(() => {
    setUntouched((u) => ({ ...u, on: !u.on }));
    setSort(DEFAULT_SORT);
  }, []);

  // A refused path never goes into a plan, whatever its checkbox said.
  const selected = useMemo(
    () =>
      found.filter(
        (c) => !spared.has(c.path) && riskOf(c, flow.refused) !== "refused",
      ),
    [found, spared, flow.refused],
  );
  const pickedActions = useMemo(
    () => actions.filter((a) => a.available && pickedIds.has(a.action)),
    [actions, pickedIds],
  );
  const reclaim = useMemo(
    () => reclaimOf(selected, found, pickedActions, actions),
    [selected, found, pickedActions, actions],
  );

  const pickAction = useCallback((id, picked) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (picked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

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
    for (const c of [...selected, ...pickedActions]) {
      if (riskOf(c) === "caution" && !byId.has(c.id)) byId.set(c.id, c);
    }
    return [...byId.values()];
  }, [selected, pickedActions]);

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

      <ScanTelemetry scan={telemetry.state} elapsedMs={telemetry.elapsedMs} />

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

      <DeleteRun run={flow.run} noun={NOUN} />

      {(arrived.length > 0 || actions.length > 0) && (
        <div className="results">
          <div className="results-main">
            <div className="bulk">
              <button onClick={() => setChecked(found.map((c) => c.path), true)}>Select all</button>
              <button onClick={() => setChecked(found.map((c) => c.path), false)}>
                Select none
              </button>
              <UntouchedFilter
                on={untouched.on}
                days={untouched.days}
                onToggle={toggleUntouched}
                onDays={(days) => setUntouched((u) => ({ ...u, days }))}
              />
            </div>

            {arrived.length > 0 && found.length === 0 && (
              <p className="empty">No project untouched for {untouched.days} days.</p>
            )}

            {(found.length > 0 || actions.length > 0) && (
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
                  {rules.map((rule, i) => (
                    <CacheRuleRows
                      key={rule.id}
                      rule={rule}
                      now={scannedAt}
                      enterDelay={enterDelay(i)}
                      refused={flow.refused}
                      fateOf={(path) => fateOf(flow.run, path)}
                      open={opened.has(rule.id)}
                      onToggle={toggleOpen}
                      spared={spared}
                      setChecked={setChecked}
                      onPointerDown={onPointerDown}
                      onPointerEnter={onPointerEnter}
                    />
                  ))}
                </tbody>
                {actions.length > 0 && (
                  <tbody className="actions">
                    {actions.map((action) => (
                      <ActionRow
                        key={action.action}
                        action={action}
                        checked={pickedIds.has(action.action)}
                        onChange={(picked) => pickAction(action.action, picked)}
                      />
                    ))}
                  </tbody>
                )}
              </table>
            )}
          </div>

          <ReclaimPanel
            reclaim={reclaim}
            replayKey={telemetry.state.finishedAt}
            noun={NOUN}
            permanent={flow.permanent}
            busy={flow.planning}
            disabled={flow.deleting}
            onZap={() =>
              flow.preparePlan(selected, reclaim.selected, pickedActions.map((a) => a.action))
            }
          >
            {cautions.length > 0 && (
              <Callout tone="caution" title="Read before deleting">
                <ul>
                  {cautions.map((c) => (
                    <li key={c.id}>
                      <strong>{c.label}</strong> — {c.riskNote}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </ReclaimPanel>
        </div>
      )}

      {summary && arrived.length === 0 && actions.length === 0 && (
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
