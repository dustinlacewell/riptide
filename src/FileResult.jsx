import { useState } from "react";

/**
 * One file in the search results: a header row that expands to show the
 * matching lines.
 */
export default function FileResult({ file, root }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`file-result${open ? " open" : ""}`}>
      <button className="file-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className="file-path" title={file.path}>
          {relativeTo(file.path, root)}
        </span>
        <span className="file-count">
          {file.matches} {file.matches === 1 ? "match" : "matches"}
        </span>
      </button>

      {open && (
        <div className="file-lines">
          {file.lines.map((line, i) => (
            <div className="match-line" key={`${line.line}-${i}`}>
              <span className="line-no">{line.line}</span>
              <code>{highlight(line.text, line.spans)}</code>
            </div>
          ))}
          {file.truncated && (
            <div className="match-line more">
              …{file.matches - file.lines.length} more in this file
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Wrap each matched span in a <mark>.
 *
 * ripgrep reports spans as byte offsets, which only line up with JS string
 * indices while the line is ASCII. A line containing multi-byte characters
 * is shown unhighlighted rather than sliced at the wrong place.
 */
function highlight(text, spans) {
  if (!spans?.length) return text;

  const bytes = new TextEncoder().encode(text);
  if (bytes.length !== text.length) return text;

  const parts = [];
  let at = 0;

  for (const [start, end] of spans) {
    if (start < at || end > text.length) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));

  return parts;
}

/** Show the path relative to the searched root; it is shorter and reads better. */
function relativeTo(full, root) {
  if (!root) return full;
  const prefix = root.endsWith("\\") ? root : root + "\\";
  return full.toLowerCase().startsWith(prefix.toLowerCase())
    ? full.slice(prefix.length)
    : full;
}
