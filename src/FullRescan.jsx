/**
 * Read the drive's whole MFT again instead of updating the kept tree from
 * the change journal. Sits next to each tab's scan button.
 */
export default function FullRescan({ onClick, disabled }) {
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
