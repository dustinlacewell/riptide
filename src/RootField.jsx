import { useState } from "react";
import DirectoryPicker from "./DirectoryPicker.jsx";

/**
 * The "Search under" control, shared by both tabs.
 *
 * Typing a path stays the fast route for anyone who knows it; Browse opens
 * the picker for anyone who does not. Recent roots sit below as one-click
 * repeats, seeded with the drives so the row is never empty.
 */
export default function RootField({
  root,
  setRoot,
  chooseRoot,
  roots,
  recent,
  placeholder,
}) {
  const [browsing, setBrowsing] = useState(false);

  // The current root is always the newest recent, so it would otherwise sit
  // at the front of this row as a button that sets what is already set.
  const notCurrent = (r) => r.toLowerCase() !== (root ?? "").toLowerCase();
  const others = recent.filter(notCurrent);
  const shortcuts = others.length > 0 ? others : drives(roots).filter(notCurrent);

  return (
    <>
      <label className="root-field">
        Search under
        <span className="root-input">
          <input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
          />
          <button className="browse" onClick={() => setBrowsing(true)}>
            Browse
          </button>
        </span>
      </label>

      {shortcuts.length > 0 && (
        <div className="chips">
          {shortcuts.map((r) => (
            <button key={r} className="chip" onClick={() => chooseRoot(r)} title={r}>
              {r}
            </button>
          ))}
        </div>
      )}

      {browsing && (
        <DirectoryPicker
          roots={roots}
          recent={recent}
          onCancel={() => setBrowsing(false)}
          onPick={(picked) => {
            setBrowsing(false);
            chooseRoot(picked);
          }}
        />
      )}
    </>
  );
}

function drives(roots) {
  return roots ? [roots.home, ...roots.drives] : [];
}
