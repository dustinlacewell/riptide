/**
 * The riptide wave. Strokes in currentColor, so the parent sets its color.
 */
export default function WaveMark({ size = 28 }) {
  return (
    <svg
      className="wave-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path d="M5 21C5 12 11 6 18 6c5 0 9 3 9 7 0 3.5-2.5 5.5-5.5 5.5-2.5 0-4-1.7-4-3.5 0-1.6 1.2-2.6 2.5-2.6" />
      <path d="M3 26c3 0 4.5-2 7.5-2s4.5 2 7.5 2 4.5-2 7.5-2c1.5 0 2.5.6 3.5 1.3" />
    </svg>
  );
}
