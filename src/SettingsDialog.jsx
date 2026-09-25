import { useEffect, useState } from "react";
import { useSource } from "./source/context.js";
import { bytes } from "./format.js";
import { KEEP_CHOICES } from "./persist.js";
import Dialog from "./ui/Dialog.jsx";

/**
 * App-wide settings. For now one: how many drives the server keeps in
 * memory so the next scan of them is an update, not a whole-MFT read.
 *
 * The memory hint comes from the server's last read; before any read it
 * is not known and not shown.
 */
export default function SettingsDialog({ keepDrives, onKeepDrives, onClose }) {
  const api = useSource();
  const [perDrive, setPerDrive] = useState(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setPerDrive(s.bytesPerDrive))
      .catch(() => setPerDrive(null));
  }, [api]);

  return (
    <Dialog title="Settings" onClose={onClose} className="app-settings">
      <label className="setting">
        Drives kept ready for fast rescans
        <select
          autoFocus
          value={keepDrives}
          onChange={(e) => onKeepDrives(Number(e.target.value))}
        >
          {KEEP_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "0 (always read the whole drive)" : n}
            </option>
          ))}
        </select>
      </label>
      {perDrive !== null && <p className="setting-hint">≈ {bytes(perDrive)} per drive</p>}

      <div className="actions">
        <button onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}
