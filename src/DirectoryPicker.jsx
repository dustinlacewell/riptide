import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api.js";
import { crumbs } from "./crumbs.js";

/**
 * Browse the filesystem for a root directory.
 *
 * The list is one level deep and always reflects one path: descending
 * replaces it rather than nesting a tree, so a deep folder costs the same
 * as a shallow one and there is nothing to keep in sync.
 *
 * The top level is a synthetic listing of drives and home, since a drive
 * root has no parent to walk up to.
 */
export default function DirectoryPicker({ roots, recent, onPick, onCancel }) {
  // null path means the synthetic drive list; a string means a real listing.
  const [at, setAt] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(0);

  const listRef = useRef(null);
  const dialogRef = useRef(null);
  // Each load gets a number; a slow one that lands after a newer one is
  // dropped, so a cold drive cannot overwrite the folder you moved on to.
  const runId = useRef(0);

  // The top level is derived, not fetched — it is the props rearranged.
  const top = useMemo(() => driveListing(roots), [roots]);

  // The fetch is the only thing an effect is for here. Everything the list
  // renders comes out of it, so a listing for the wrong path never shows.
  useEffect(() => {
    if (at === null) return;

    const id = ++runId.current;

    api
      .getDirs(at)
      .then((result) => {
        if (id === runId.current) setLoaded(result);
      })
      .catch((e) => {
        if (id !== runId.current) return;
        setError(e.message);
        setLoaded({ path: at, parent: null, entries: [] });
      });
  }, [at]);

  // A listing left over from the folder we just left is not this folder's,
  // so it counts as still loading rather than as stale content to show.
  const listing = at === null ? top : loaded?.path === at ? loaded : null;
  const loading = listing === null;
  const entries = listing?.entries ?? [];
  const selected = at ?? "";

  // Navigation resets the cursor and clears the last error, at the event
  // that causes both rather than in an effect watching for it.
  const goTo = useCallback((path) => {
    setAt(path);
    setCursor(0);
    setError(null);
  }, []);

  const enter = useCallback(
    (entry) => {
      if (entry.accessible) goTo(entry.path);
    },
    [goTo],
  );

  // The server reports the parent, but during a load there is no listing to
  // read it from — and "up" must work while a slow drive is still thinking.
  // The crumbs know the same answer from the path alone.
  const up = useCallback(() => {
    if (listing) return goTo(listing.parent);
    const trail = crumbs(at);
    goTo(trail.length > 1 ? trail[trail.length - 2].path : null);
  }, [goTo, listing, at]);

  function onKeyDown(e) {
    if (e.key === "Escape") return onCancel();

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor((c) => clamp(c + step, entries.length));
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setCursor(e.key === "Home" ? 0 : entries.length - 1);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      return up();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter descends into the highlighted row; with nothing highlighted
      // it takes the folder you are standing in.
      const entry = entries[cursor];
      if (entry && entry.accessible) enter(entry);
      else if (selected) onPick(selected);
    }
  }

  // The dialog takes focus once, on open, so the arrow keys land here rather
  // than on whatever was focused behind the backdrop.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Keep the highlighted row on screen when the arrows walk past the edge.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-cursor="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, listing]);

  return (
    <div className="backdrop" onClick={onCancel}>
      <div
        className="dialog picker"
        role="dialog"
        aria-label="Choose a folder"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        ref={dialogRef}
      >
        <div className="picker-bar">
          <button className="crumb" onClick={() => goTo(null)} title="Drives">
            drives
          </button>
          {crumbs(at).map((crumb) => (
            <button
              key={crumb.path}
              className="crumb"
              onClick={() => goTo(crumb.path)}
              title={crumb.path}
            >
              <span className="sep">\</span>
              {crumb.label}
            </button>
          ))}
        </div>

        {recent.length > 0 && at === null && (
          <div className="picker-recent">
            <span className="label">recent</span>
            {recent.map((r) => (
              <button key={r} className="chip" onClick={() => goTo(r)} title={r}>
                {r}
              </button>
            ))}
          </div>
        )}

        <div className="picker-list" ref={listRef}>
          {/* Anywhere but the top has a level above it: a real parent, or
              the drive list when standing on a drive root. It stays put
              during a load so the way back does not blink out. */}
          {at !== null && (
            <button className="row up" onClick={up}>
              <span className="caret">▴</span>
              <span className="row-name">..</span>
            </button>
          )}

          {entries.map((entry, i) => (
            <button
              key={entry.path}
              className={rowClass(entry, i === cursor)}
              data-cursor={i === cursor}
              onClick={() => {
                setCursor(i);
                enter(entry);
              }}
              disabled={!entry.accessible}
              title={entry.accessible ? entry.path : `${entry.path} — no access`}
            >
              <span className="caret">▸</span>
              <span className="row-name">{entry.name}</span>
              {!entry.accessible && <span className="row-note">no access</span>}
            </button>
          ))}

          {loading && <p className="picker-status">reading…</p>}

          {!loading && entries.length === 0 && !error && (
            <p className="picker-status">no subfolders</p>
          )}
        </div>

        {error && <p className="error picker-error">{error}</p>}

        <div className="picker-foot">
          <span className="picker-selected" title={selected}>
            {selected || "no folder selected"}
          </span>
          <div className="actions">
            <button onClick={onCancel}>Cancel</button>
            <button className="primary" disabled={!selected} onClick={() => onPick(selected)}>
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The top level: drives and home, shaped like a real listing so the list
 * renderer does not need to know the difference.
 */
function driveListing(roots) {
  const paths = roots ? [roots.home, ...roots.drives] : [];
  const seen = new Set();

  const entries = paths
    .filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
    .map((p) => ({ name: p, path: p, hidden: false, accessible: true }));

  return { path: null, parent: null, entries };
}

/** Wrap the cursor at both ends; an empty list keeps it at zero. */
function clamp(next, length) {
  if (length === 0) return 0;
  return (next + length) % length;
}

function rowClass(entry, active) {
  return [
    "row",
    entry.hidden ? "hidden-entry" : "",
    !entry.accessible ? "denied" : "",
    active ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
