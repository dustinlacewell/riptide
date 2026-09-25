/**
 * The icon set. Each glyph draws in currentColor, so the parent sets its
 * color. With a label it is announced as an image; without one it is
 * decoration and hidden from assistive tech.
 */
export default function Glyph({ name, size = 12, label, className }) {
  const glyph = GLYPHS[name];
  return (
    <svg
      className={className ? `glyph ${className}` : "glyph"}
      width={size}
      height={size}
      viewBox={glyph.box}
      fill={glyph.fill ? "currentColor" : "none"}
      stroke={glyph.fill ? "none" : "currentColor"}
      strokeWidth={glyph.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {glyph.body}
    </svg>
  );
}

const GLYPHS = {
  safe: { box: "0 0 12 12", fill: true, body: <circle cx="6" cy="6" r="5" /> },
  caution: { box: "0 0 12 12", fill: true, body: <path d="M6 1 11.5 11H.5Z" /> },
  refused: {
    box: "0 0 12 12",
    stroke: 1.6,
    body: (
      <>
        <circle cx="6" cy="6" r="4.6" />
        <path d="M2.8 9.2 9.2 2.8" />
      </>
    ),
  },
  done: { box: "0 0 12 12", stroke: 1.6, body: <path d="M1.5 6.5 4.5 9.5 10.5 2.5" /> },
  failed: { box: "0 0 12 12", stroke: 1.6, body: <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /> },
  caret: { box: "0 0 12 12", stroke: 1.6, body: <path d="M4.5 2.5 8 6l-3.5 3.5" /> },
  lock: {
    box: "0 0 14 14",
    stroke: 1.6,
    body: (
      <>
        <rect x="2.5" y="6" width="9" height="6.5" rx="1.2" />
        <path d="M4.5 6V4.2a2.5 2.5 0 0 1 5 0V6" />
      </>
    ),
  },
  cog: {
    box: "0 0 24 24",
    stroke: 1.8,
    body: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
  },
};
