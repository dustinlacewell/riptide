import { useCaps } from "./source/context.js";

/**
 * Read the drive's whole MFT again instead of updating the kept tree from
 * the change journal. Sits next to each tab's scan button. A source with
 * no kept tree (the demo) shows none.
 */
export default function FullRescan({ onClick, disabled }) {
  const caps = useCaps();
  if (!caps.fullRescan) return null;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Read the whole drive again instead of only what changed"
    >
      Full rescan
    </button>
  );
}
