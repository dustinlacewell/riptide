import { useCallback, useEffect, useState } from "react";
import * as api from "./api.js";
import ZapPanel from "./ZapPanel.jsx";
import SearchPanel from "./SearchPanel.jsx";
import CachePanel from "./CachePanel.jsx";
import { COLUMNS, DEFAULT_SORT } from "./sort.js";
import { load, remember, save } from "./persist.js";
import WaveMark from "./ui/WaveMark.jsx";

const TABS = {
  zap: { label: "Zap", tagline: "Find build junk. Keep what you need. Zap the rest." },
  search: { label: "Search", tagline: "ripgrep across the tree, grouped by file." },
  caches: { label: "Caches", tagline: "Known tool caches, found by path." },
};

const DEFAULTS = {
  root: "",
  recentRoots: [],
  patterns: "node_modules",
  sort: DEFAULT_SORT,
  tab: "zap",
  pattern: "",
  globs: "",
  caseMode: "smart",
  regex: true,
  disabledCaches: [],
};

const SORT_KEYS = Object.keys(COLUMNS);

/**
 * Shell around the two tabs. It owns what they share — the root directory,
 * the drive list, and persisted preferences — so switching tabs keeps the
 * root you were working under.
 */
export default function App() {
  const [prefs, setPrefs] = useState(() => load(DEFAULTS, SORT_KEYS));

  const [tab, setTab] = useState(prefs.tab);
  const [root, setRoot] = useState(prefs.root);
  const [recentRoots, setRecentRoots] = useState(prefs.recentRoots ?? []);
  const [roots, setRoots] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getRoots()
      .then((r) => {
        setRoots(r);
        // Home is a starting point, not an override — a remembered root wins.
        setRoot((current) => current || r.home);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Panels report their own settings up; everything lands in one stored blob.
  const onPrefsChange = useCallback((patch) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  // A deliberate pick — from the browser or a shortcut — joins the recent
  // list. Typing in the field does not: half-written paths are not places
  // anyone wants to come back to.
  const chooseRoot = useCallback((picked) => {
    setRoot(picked);
    setRecentRoots((prev) => remember(prev, picked));
  }, []);

  useEffect(() => {
    save({ ...prefs, root, recentRoots, tab });
  }, [prefs, root, recentRoots, tab]);

  const shared = { root, setRoot, chooseRoot, recentRoots, roots, prefs, onPrefsChange };

  return (
    <>
      <header className="app-header">
        <div className="wordmark">
          <WaveMark />
          <span>riptide</span>
        </div>

        <nav className="tabs" aria-label="Tools">
          {Object.entries(TABS).map(([key, { label, tagline }]) => (
            <button
              key={key}
              className={`tab${tab === key ? " active" : ""}`}
              aria-current={tab === key ? "page" : undefined}
              title={tagline}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app">
        {error && <p className="error">{error}</p>}

        {tab === "zap" && <ZapPanel {...shared} />}
        {tab === "search" && <SearchPanel {...shared} />}
        {tab === "caches" && <CachePanel {...shared} />}
      </main>
    </>
  );
}
