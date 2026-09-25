import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api.js";
import { bytes, sumBytes } from "./format.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import ZapStatus from "./ZapStatus.jsx";
import CacheSettings from "./CacheSettings.jsx";
import RootField from "./RootField.jsx";
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

  const scan = useCallback(async () => {
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
      });

      setProblems(done.errors ?? []);
      setSummary(done);
      if (done.failure) flow.setError(done.failure);
    } catch (e) {
      flow.setError(e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [flow, disabled, root]);

  // Grouping and sorting happen at render, not on arrival, so re-sorting
  // never has to wait for another scan.
  const rules = useMemo(
    () => sortGroups(groupHits(arrived), sort),
    [arrived, sort],
  );

  // The flat list stays the source of truth for the summary, the bulk
  // buttons and the zap plan; only the table is grouped.
  const found = arrived;

  const selected = useMemo(
    () => found.filter((c) => !spared.has(c.path)),
    [found, spared],
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
      if (c.caution && !byId.has(c.id)) byId.set(c.id, c);
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
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zm0 1.2a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6z"
            />
            <path
              fill="currentColor"
              d="M7.1 1h1.8l.25 1.6a5.4 5.4 0 011.2.5l1.32-.95 1.27 1.27-.95 1.32c.21.38.38.78.5 1.2L14 6.2v1.8l-1.6.25c-.12.42-.29.82-.5 1.2l.95 1.32-1.27 1.27-1.32-.95c-.38.21-.78.38-1.2.5L8.9 15H7.1l-.25-1.6a5.4 5.4 0 01-1.2-.5l-1.32.95-1.27-1.27.95-1.32a5.4 5.4 0 01-.5-1.2L2 8.9V7.1l1.6-.25c.12-.42.29-.82.5-1.2l-.95-1.32 1.27-1.27 1.32.95c.38-.21.78-.38 1.2-.5L7.1 1zm.87 1.2l-.2 1.3-.6.16a4.2 4.2 0 00-.93.39l-.54.3-1.07-.76-.16.16.77 1.07-.3.54c-.17.29-.3.6-.4.93l-.15.6-1.3.2v.22l1.3.2.16.6c.1.33.22.64.39.93l.3.54-.77 1.07.16.16 1.07-.77.54.3c.29.17.6.3.93.4l.6.15.2 1.3h.22l.2-1.3.6-.16c.33-.1.64-.22.93-.39l.54-.3 1.07.77.16-.16-.77-1.07.3-.54c.17-.29.3-.6.4-.93l.15-.6 1.3-.2v-.22l-1.3-.2-.16-.6a4.2 4.2 0 00-.39-.93l-.3-.54.77-1.07-.16-.16-1.07.77-.54-.3a4.2 4.2 0 00-.93-.4l-.6-.15-.2-1.3h-.22z"
            />
          </svg>
        </button>

        <button className="primary" onClick={scan} disabled={loading}>
          {loading ? "Looking…" : summary ? "Rescan" : "Find caches"}
        </button>
      </section>

      {!summary && !loading && (
        <p className="note">
          Searches under the root only. Reads that drive's MFT, so expect a
          minute or two.
        </p>
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
        <details className="problems">
          <summary>{problems.length} pack issues</summary>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
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
                {Object.entries(CACHE_GROUP_COLUMNS).map(([key, col]) => (
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
              {rules.map((rule) => (
                <RuleRows
                  key={rule.id}
                  rule={rule}
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
            <div className="refused">
              <strong>Read before deleting</strong>
              <ul>
                {cautions.map((c) => (
                  <li key={c.path}>
                    {c.label} — {c.caution}
                  </li>
                ))}
              </ul>
            </div>
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

/**
 * One cache rule: a summary row that expands to its instances.
 *
 * A rule matched by directory name hits once per project, so __pycache__
 * alone is eleven thousand rows. Collapsed, it is one.
 *
 * Selection is not held here. The rule's checkbox reads and writes the
 * panel's set of spared paths, so the zap plan stays a single flat path
 * list no matter which rows happen to be open.
 */
function RuleRows({
  rule,
  open,
  onToggle,
  spared,
  setChecked,
  onPointerDown,
  onPointerEnter,
}) {
  const paths = rule.paths.map((c) => c.path);
  const chosen = paths.filter((p) => !spared.has(p)).length;
  const all = chosen === paths.length;
  const none = chosen === 0;

  // A one-instance rule is just a row: show where it is rather than the
  // count "1", and give it no caret to open.
  const lone = rule.count === 1 ? rule.paths[0] : null;

  return (
    <>
      <tr className={`rule${none ? " spared" : ""}${open ? " open" : ""}`}>
        <td className="grip">
          {!lone && (
            <button
              className="twist"
              onClick={() => onToggle(rule.id)}
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} ${rule.count} locations`}
            >
              <span className="caret">{open ? "▾" : "▸"}</span>
            </button>
          )}
        </td>
        <td>
          <TriCheckbox
            checked={all}
            mixed={!all && !none}
            onChange={() => setChecked(paths, !all)}
          />
        </td>
        <td>
          <span className="cache-label">{rule.label}</span>
          {rule.caution && (
            <span className="caution-flag" title={rule.caution}>
              caution
            </span>
          )}
          <span className="cache-cost">{rule.cost}</span>
        </td>
        {lone ? (
          <td className="path" title={lone.path}>
            {lone.path}
          </td>
        ) : (
          <td className="rule-count">
            {rule.count.toLocaleString()} locations
            {!all && !none && (
              <span className="rule-chosen">{chosen.toLocaleString()} selected</span>
            )}
          </td>
        )}
        <td className="num">{bytes(rule.bytes)}</td>
        <td className="num">{rule.files.toLocaleString()}</td>
      </tr>

      {open &&
        !lone &&
        rule.paths.map((cache) => (
          <tr
            key={cache.path}
            className={`member${spared.has(cache.path) ? " spared" : ""}`}
            onPointerDown={(e) => onPointerDown(e, cache.path)}
            onPointerEnter={() => onPointerEnter(cache.path)}
          >
            <td className="grip" />
            <td>
              <input
                type="checkbox"
                checked={!spared.has(cache.path)}
                onChange={(e) => setChecked([cache.path], e.target.checked)}
              />
            </td>
            <td className="path" colSpan={2} title={cache.path}>
              {cache.path}
            </td>
            <td className="num">{bytes(cache.bytes)}</td>
            <td className="num">{cache.files.toLocaleString()}</td>
          </tr>
        ))}
    </>
  );
}

/**
 * A checkbox that can also show "some of these".
 *
 * There is no `indeterminate` attribute or React prop — it is a property on
 * the DOM node only — so it has to be written through a ref after render.
 */
function TriCheckbox({ checked, mixed, onChange }) {
  const box = useRef(null);

  useEffect(() => {
    if (box.current) box.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <input ref={box} type="checkbox" checked={checked} onChange={onChange} />
  );
}
