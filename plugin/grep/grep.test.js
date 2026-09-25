/**
 * Tests for ripgrep argument building and event parsing.
 *
 *   node --test plugin/grep/grep.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildArgs, parseGlobs, MAX_RESULTS } from "./args.js";
import { decodeText, interpret, createGrouper } from "./events.js";

// --- arguments -------------------------------------------------------------

const base = { pattern: "foo", root: "D:\\code" };

test("args: pattern and root go after -- as positionals", () => {
  const args = buildArgs(base);
  const sep = args.indexOf("--");
  assert.ok(sep !== -1, "the option terminator is present");
  assert.deepEqual(args.slice(sep + 1), ["foo", "D:\\code"]);
});

test("args: a pattern starting with a dash is not read as a flag", () => {
  // Without "--", rg would treat "-i" as an option rather than a search term.
  const args = buildArgs({ ...base, pattern: "-i" });
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["-i", "D:\\code"]);
});

test("args: shell metacharacters stay in one argument", () => {
  // Nothing is ever joined into a shell string, so these are inert.
  const pattern = '"; rm -rf / #';
  const args = buildArgs({ ...base, pattern });
  assert.ok(args.includes(pattern), "the pattern survives verbatim as one element");
});

test("args: case mode maps to the right flag", () => {
  assert.ok(buildArgs(base).includes("--smart-case"));
  assert.ok(buildArgs({ ...base, caseMode: "sensitive" }).includes("--case-sensitive"));
  assert.ok(buildArgs({ ...base, caseMode: "insensitive" }).includes("--ignore-case"));
});

test("args: literal search disables regex", () => {
  assert.ok(buildArgs({ ...base, regex: false }).includes("--fixed-strings"));
  assert.ok(!buildArgs({ ...base, regex: true }).includes("--fixed-strings"));
});

test("args: optional flags appear only when asked for", () => {
  const plain = buildArgs(base);
  assert.ok(!plain.includes("--hidden"));
  assert.ok(!plain.includes("--word-regexp"));

  const loud = buildArgs({ ...base, hidden: true, word: true });
  assert.ok(loud.includes("--hidden"));
  assert.ok(loud.includes("--word-regexp"));
});

test("args: each glob becomes its own --glob pair", () => {
  const args = buildArgs({ ...base, globs: ["*.js", "!dist"] });
  assert.equal(args.filter((a) => a === "--glob").length, 2);
  assert.ok(args.includes("*.js"));
  assert.ok(args.includes("!dist"));
});

test("args: max-count is clamped to a sane ceiling", () => {
  const args = buildArgs({ ...base, maxResults: 10_000_000 });
  const value = Number(args[args.indexOf("--max-count") + 1]);
  assert.equal(value, MAX_RESULTS);
});

test("args: an empty pattern is rejected", () => {
  assert.throws(() => buildArgs({ ...base, pattern: "" }), /pattern is required/);
});

test("globs: split on commas and trim", () => {
  assert.deepEqual(parseGlobs(" *.ts , !node_modules ,, "), ["*.ts", "!node_modules"]);
  assert.deepEqual(parseGlobs(""), []);
});

// --- event decoding --------------------------------------------------------

test("decode: plain text fields pass through", () => {
  assert.equal(decodeText({ text: "hello" }), "hello");
});

test("decode: non-UTF8 fields arrive base64 encoded", () => {
  // ripgrep switches to {bytes} when a path or line is not valid UTF-8.
  const encoded = Buffer.from("caf\u00e9", "utf8").toString("base64");
  assert.equal(decodeText({ bytes: encoded }), "caf\u00e9");
});

test("decode: a missing field is an empty string, not a crash", () => {
  assert.equal(decodeText(undefined), "");
  assert.equal(decodeText({}), "");
});

test("interpret: a match carries line number, text and spans", () => {
  const note = interpret({
    type: "match",
    data: {
      path: { text: "D:\\a.js" },
      line_number: 12,
      lines: { text: "const foo = 1\n" },
      submatches: [{ start: 6, end: 9 }],
    },
  });
  assert.equal(note.kind, "match");
  assert.equal(note.line, 12);
  assert.equal(note.text, "const foo = 1", "the trailing newline is stripped");
  assert.deepEqual(note.spans, [[6, 9]]);
});

test("interpret: unknown event types are ignored", () => {
  assert.equal(interpret({ type: "context" }), null);
  assert.equal(interpret(null), null);
});

// --- grouping --------------------------------------------------------------

const beginEvent = (path) => interpret({ type: "begin", data: { path: { text: path } } });
const matchEvent = (path, line, text) =>
  interpret({
    type: "match",
    data: { path: { text: path }, line_number: line, lines: { text }, submatches: [] },
  });
const endEvent = (path, matches) =>
  interpret({ type: "end", data: { path: { text: path }, stats: { matches } } });

test("group: a file is emitted complete when its end event lands", () => {
  const g = createGrouper();
  assert.equal(g.push(beginEvent("a.js")), null);
  assert.equal(g.push(matchEvent("a.js", 1, "foo")), null, "matches do not emit");
  assert.equal(g.push(matchEvent("a.js", 5, "foo again")), null);

  const group = g.push(endEvent("a.js", 2));
  assert.equal(group.path, "a.js");
  assert.equal(group.matches, 2);
  assert.deepEqual(group.lines.map((l) => l.line), [1, 5]);
});

test("group: consecutive files stay separate", () => {
  const g = createGrouper();
  g.push(beginEvent("a.js"));
  g.push(matchEvent("a.js", 1, "x"));
  const first = g.push(endEvent("a.js", 1));

  g.push(beginEvent("b.js"));
  g.push(matchEvent("b.js", 9, "y"));
  const second = g.push(endEvent("b.js", 1));

  assert.equal(first.path, "a.js");
  assert.equal(second.path, "b.js");
  assert.equal(second.lines.length, 1, "b does not inherit a's matches");
});

test("group: a file with no matches emits nothing", () => {
  const g = createGrouper();
  g.push(beginEvent("a.js"));
  assert.equal(g.push(endEvent("a.js", 0)), null);
});

test("group: per-file matches are capped but the true count is kept", () => {
  const g = createGrouper({ maxMatchesPerFile: 3 });
  g.push(beginEvent("big.js"));
  for (let i = 1; i <= 10; i++) g.push(matchEvent("big.js", i, "hit"));

  const group = g.push(endEvent("big.js", 10));
  assert.equal(group.lines.length, 3, "only the first few lines are kept");
  assert.equal(group.truncated, true);
  assert.equal(group.matches, 10, "the real total still reports 10");
});
