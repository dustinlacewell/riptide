import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api.js";
import ZapPanel from "./ZapPanel.jsx";
import SearchPanel from "./SearchPanel.jsx";
import CachePanel from "./CachePanel.jsx";
import MapPanel from "./MapPanel.jsx";
import { COLUMNS, DEFAULT_SORT } from "./sort.js";
import { load, remember, save } from "./persist.js";
import WaveMark from "./ui/WaveMark.jsx";

const TABS = {
  zap: {
    label: "Zap",
    about: "Find folders by name and send them to the Recycle Bin.",
    Panel: ZapPanel,
  },
  caches: {
    label: "Caches",
    about: "Find tool caches and build folders you can safely delete.",
    Panel: CachePanel,
  },
  map: {
    label: "Map",
    about: "See where all the space on a drive went.",
    Panel: MapPanel,
  },
  search: {
    label: "Search",
    about: "Search file contents with ripgrep.",
    Panel: SearchPanel,
  },
};

const TAB_KEYS = Object.keys(TABS);

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
 * Shell around the tabs. It owns what they share — the root directory, the
 * drive list, and persisted preferences — so switching tabs keeps the root
 * you were working under.
 *
 * Every panel stays mounted; switching tabs only hides the others. A scan
 * or search keeps running in a hidden tab, and its tab shows a busy mark.
 */
export default function App() {
  const [prefs, setPrefs] = useState(() => load(DEFAULTS, SORT_KEYS));

  const [tab, setTab] = useState(TABS[prefs.tab] ? prefs.tab : "zap");
  const [root, setRoot] = useState(prefs.root);
  const [recentRoots, setRecentRoots] = useState(prefs.recentRoots ?? []);
  const [roots, setRoots] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({});

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

  // One stable reporter per tab, so a panel's busy effect runs only when
  // its own busy flag changes.
  const reportBusy = useMemo(
    () =>
      Object.fromEntries(
        TAB_KEYS.map((key) => [
          key,
          (value) => setBusy((prev) => (prev[key] === value ? prev : { ...prev, [key]: value })),
        ]),
      ),
    [],
  );

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

        <div className="tabs" role="tablist" aria-label="Tools">
          {TAB_KEYS.map((key) => (
            <button
              key={key}
              id={`tab-${key}`}
              role="tab"
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              className={`tab${tab === key ? " active" : ""}`}
              onClick={() => setTab(key)}
            >
              {TABS[key].label}
              {busy[key] && tab !== key && (
                <span className="tab-busy" role="status" aria-label="working" />
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="app">
        <p className="tab-about">{TABS[tab].about}</p>

        {error && <p className="error">{error}</p>}

        {TAB_KEYS.map((key) => {
          const { Panel } = TABS[key];
          return (
            <section
              key={key}
              id={`panel-${key}`}
              role="tabpanel"
              aria-labelledby={`tab-${key}`}
              className="tab-panel"
              hidden={tab !== key}
            >
              <Panel {...shared} onBusy={reportBusy[key]} />
            </section>
          );
        })}
      </main>
    </>
  );
}
