import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api.js";
import Dialog from "./ui/Dialog.jsx";

/**
 * Which cache configs are active.
 *
 * Disabled ids are sent to the server, which drops them before doing any
 * work — turning off a per-project rule saves the MFT search, not just the
 * row in the table.
 */
export default function CacheSettings({ disabled, onChange, onClose }) {
  const [configs, setConfigs] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  useEffect(() => {
    api
      .cacheConfigs()
      .then((r) => setConfigs(r.configs))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, [configs]);

  const matches = useMemo(() => {
    if (!configs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return configs;

    // Search the visible text plus the locations, so "appdata" or ".vite"
    // finds an entry whose label mentions neither.
    return configs.filter((c) =>
      [c.label, c.tool, c.pack, c.id, ...c.where]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [configs, query]);

  const byPack = useMemo(() => {
    const groups = new Map();
    for (const config of matches) {
      if (!groups.has(config.pack)) groups.set(config.pack, []);
      groups.get(config.pack).push(config);
    }
    return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
  }, [matches]);

  const off = new Set(disabled);

  function toggle(id) {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  function setMany(ids, enabled) {
    const next = new Set(off);
    for (const id of ids) {
      if (enabled) next.delete(id);
      else next.add(id);
    }
    onChange([...next]);
  }

  const shownIds = matches.map((c) => c.id);
  const enabledCount = configs
    ? configs.filter((c) => !off.has(c.id)).length
    : 0;

  return (
    <Dialog title="Cache configs" onClose={onClose} className="settings">
      <p className="reclaim">
        {configs ? `${enabledCount} of ${configs.length} enabled` : "Loading…"}
      </p>

      {error && <p className="error">{error}</p>}

      <input
        ref={searchRef}
        className="settings-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, tool, or path"
        spellCheck={false}
      />

      <div className="bulk">
        <button onClick={() => setMany(shownIds, true)}>
          Enable {query ? "shown" : "all"}
        </button>
        <button onClick={() => setMany(shownIds, false)}>
          Disable {query ? "shown" : "all"}
        </button>
      </div>

      <div className="config-list">
        {byPack.map(([pack, items]) => (
          <div key={pack} className="config-group">
            <div className="config-group-head">{pack}</div>
            {items.map((config) => (
              <label key={config.id} className="config-row">
                <input
                  type="checkbox"
                  checked={!off.has(config.id)}
                  onChange={() => toggle(config.id)}
                />
                <span className="config-main">
                  <span className="config-label">
                    {config.label}
                    {config.perProject && (
                      <span className="config-tag">per project</span>
                    )}
                    {config.risk === "caution" && (
                      <span className="caution-flag" title={config.riskNote}>
                        caution
                      </span>
                    )}
                  </span>
                  <span className="config-where">
                    {config.where.join("  ·  ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ))}

        {configs && matches.length === 0 && (
          <p className="empty">Nothing matches “{query}”.</p>
        )}
      </div>

      <div className="actions">
        <button onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}
