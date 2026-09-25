import { useCallback, useEffect, useRef, useState } from "react";
import { useSource } from "./source/context.js";
import FileResult from "./FileResult.jsx";
import RootField from "./RootField.jsx";
import Callout from "./ui/Callout.jsx";
import { useStoppable } from "./useStoppable.js";

/**
 * The Search tab: ripgrep over the same root the Zap tab scans.
 *
 * Results stream in per file, so a search across a large tree fills the
 * list as it goes rather than showing nothing until it finishes.
 */
export default function SearchPanel({
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
  const [pattern, setPattern] = useState(prefs.pattern ?? "");
  const [globs, setGlobs] = useState(prefs.globs ?? "");
  const [caseMode, setCaseMode] = useState(prefs.caseMode ?? "smart");
  const [regex, setRegex] = useState(prefs.regex !== false);

  const [files, setFiles] = useState([]);
  const [searching, setSearching] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  // Each search gets a token; results from an abandoned one are dropped so a
  // slow earlier search cannot overwrite a newer one's results.
  const runId = useRef(0);
  const run = useStoppable();

  const search = useCallback(async () => {
    if (!pattern.trim() || !root) return;

    const id = ++runId.current;
    const signal = run.begin();
    setSearching(true);
    setError(null);
    setSummary(null);
    setFiles([]);
    onPrefsChange({ pattern, globs, caseMode, regex });

    const batch = [];
    let flushing = null;

    // Repainting on every file makes a broad search crawl; collect arrivals
    // and commit them a few times a second instead.
    const flush = () => {
      flushing = null;
      if (id !== runId.current || batch.length === 0) return;
      const chunk = batch.splice(0, batch.length);
      setFiles((prev) => [...prev, ...chunk]);
    };

    try {
      const done = await api.grep(
        { root, pattern, globs, caseMode, regex },
        (file) => {
          if (id !== runId.current) return;
          batch.push(file);
          flushing ??= setTimeout(flush, 100);
        },
        signal,
      );

      if (id !== runId.current) return;
      if (flushing) clearTimeout(flushing);
      flush();

      if (done.error) setError(done.error);
      else setSummary(done);
    } catch (e) {
      if (id !== runId.current) return;
      // A stop keeps what already streamed in, including the last batch.
      if (flushing) clearTimeout(flushing);
      flush();
      if (!run.settle(e, signal)) setError(e.message);
    } finally {
      if (id === runId.current) setSearching(false);
    }
  }, [api, pattern, globs, caseMode, regex, root, onPrefsChange, run]);

  useEffect(() => onBusy?.(searching), [searching, onBusy]);

  const totalMatches = files.reduce((sum, f) => sum + f.matches, 0);

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

        <label>
          Pattern
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="TODO|FIXME"
            spellCheck={false}
          />
        </label>

        <label>
          File globs
          <input
            value={globs}
            onChange={(e) => setGlobs(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="*.js, !dist"
            spellCheck={false}
          />
        </label>

        <div className="options">
          <label className="inline">
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
            />
            Regex
          </label>

          <select value={caseMode} onChange={(e) => setCaseMode(e.target.value)}>
            <option value="smart">Smart case</option>
            <option value="insensitive">Ignore case</option>
            <option value="sensitive">Match case</option>
          </select>
        </div>

        <button
          className="primary"
          onClick={search}
          disabled={searching || !pattern.trim() || !root}
        >
          {searching ? "Searching…" : "Search"}
        </button>
        {searching && <button onClick={run.stop}>Stop</button>}
      </section>

      {run.stopped && !searching && <Callout tone="info">Stopped.</Callout>}

      {error && <p className="error">{error}</p>}

      {(files.length > 0 || summary) && (
        <div className="summary">
          <span>
            <strong>{files.length}</strong> {files.length === 1 ? "file" : "files"}
          </span>
          <span>
            <strong>{totalMatches}</strong>{" "}
            {totalMatches === 1 ? "match" : "matches"}
          </span>
          {summary && (
            <span className="strategy">
              {(summary.elapsedMs / 1000).toFixed(2)}s
              {summary.truncated && " · truncated"}
            </span>
          )}
        </div>
      )}

      {files.length > 0 && (
        <div className="file-results">
          {files.map((file) => (
            <FileResult key={file.path} file={file} root={root} />
          ))}
        </div>
      )}

      {summary && files.length === 0 && <p className="empty">No matches.</p>}
    </>
  );
}
