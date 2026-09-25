/**
 * Parsing for ripgrep's --json output.
 *
 * ripgrep emits one JSON object per line: a "begin" when it opens a file,
 * a "match" per matching line, then an "end" carrying that file's stats.
 * Grouping by file is therefore just a matter of following begin/end pairs.
 *
 * Text fields are usually {"text": "..."} but become {"bytes": "<base64>"}
 * when the content is not valid UTF-8, so every read goes through
 * decodeText rather than reaching for .text directly.
 */

/**
 * Decode a ripgrep "arbitrary data" field.
 *
 * @param {{text?: string, bytes?: string}|string|undefined} field
 * @returns {string}
 */
export function decodeText(field) {
  if (field == null) return "";
  if (typeof field === "string") return field;
  if (typeof field.text === "string") return field.text;
  if (typeof field.bytes === "string") {
    return Buffer.from(field.bytes, "base64").toString("utf8");
  }
  return "";
}

/**
 * Turn one parsed ripgrep event into something the UI can use.
 *
 * @param {object} event
 * @returns {null|{kind: "begin", path: string}
 *              |{kind: "match", path: string, line: number,
 *                text: string, spans: Array<[number, number]>}
 *              |{kind: "end", path: string, matches: number, bytes: number}
 *              |{kind: "summary", elapsedMs: number, searched: number}}
 */
export function interpret(event) {
  if (!event || typeof event !== "object") return null;

  switch (event.type) {
    case "begin":
      return { kind: "begin", path: decodeText(event.data?.path) };

    case "match": {
      const text = decodeText(event.data?.lines);
      return {
        kind: "match",
        path: decodeText(event.data?.path),
        line: event.data?.line_number ?? 0,
        // Trailing newline is part of the line ripgrep reports; it is noise
        // in a table cell.
        text: text.replace(/\r?\n$/, ""),
        spans: (event.data?.submatches ?? []).map((s) => [s.start, s.end]),
      };
    }

    case "end":
      return {
        kind: "end",
        path: decodeText(event.data?.path),
        matches: event.data?.stats?.matches ?? 0,
        bytes: event.data?.stats?.bytes_searched ?? 0,
      };

    case "summary":
      return {
        kind: "summary",
        elapsedMs: Math.round(
          (event.data?.elapsed_total?.nanos ?? 0) / 1e6 +
            (event.data?.elapsed_total?.secs ?? 0) * 1000,
        ),
        searched: event.data?.stats?.searches ?? 0,
      };

    default:
      return null;
  }
}

/**
 * Accumulate interpreted events into per-file groups.
 *
 * Matches arrive between their file's begin and end, so a group is emitted
 * complete — path, match count, and lines together — the moment its end
 * event lands. The UI never has to stitch partial files back together.
 */
export function createGrouper({ maxMatchesPerFile = 200 } = {}) {
  let current = null;

  return {
    /**
     * @param {object} note an interpreted event
     * @returns {null|object} a finished file group, when one completes
     */
    push(note) {
      if (!note) return null;

      switch (note.kind) {
        case "begin":
          current = { path: note.path, matches: 0, truncated: false, lines: [] };
          return null;

        case "match":
          // A file with thousands of hits would blow up the payload and the
          // DOM; keep the first N and record that more exist.
          if (!current) current = { path: note.path, matches: 0, truncated: false, lines: [] };
          if (current.lines.length < maxMatchesPerFile) {
            current.lines.push({
              line: note.line,
              text: note.text,
              spans: note.spans,
            });
          } else {
            current.truncated = true;
          }
          return null;

        case "end": {
          if (!current) return null;
          const group = { ...current, matches: note.matches };
          current = null;
          return group.lines.length > 0 ? group : null;
        }

        default:
          return null;
      }
    },
  };
}
