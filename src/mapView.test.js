/**
 * Tests for the space map's view data: nesting, labels and tile tones.
 *
 *   node --test src/mapView.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  HEADER,
  fitLabel,
  junkShare,
  layoutPage,
  selectable,
  tileClass,
  toneOf,
} from "./mapView.js";

const row = (id, bytes, over = {}) => ({
  id,
  recNo: id + 100,
  name: `dir${id}`,
  bytes,
  files: 1,
  junk: null,
  junkBytes: 0,
  hasKids: false,
  ...over,
});

const listing = (children, over = {}) => ({
  children,
  other: { count: 0, bytes: 0 },
  ownFiles: { bytes: 0, count: 0 },
  ...over,
});

const RECT = { x: 0, y: 0, w: 800, h: 500 };

test("layout: children nest inside their parent, under its header", () => {
  const page = listing([
    row(1, 600, { hasKids: true, kids: listing([row(3, 400), row(4, 200)]) }),
    row(2, 400),
  ]);
  const tiles = layoutPage(page, RECT);
  const parent = tiles.find((t) => t.id === 1);
  const kids = tiles.filter((t) => t.parent === parent.key);
  assert.equal(parent.nested, true);
  assert.equal(kids.length, 2);
  for (const k of kids) {
    assert.equal(k.depth, 2);
    assert.ok(k.y >= parent.y + HEADER - 1e-9);
    assert.ok(k.x >= parent.x && k.x + k.w <= parent.x + parent.w + 1e-9);
  }
  assert.equal(tiles.find((t) => t.id === 2).nested, false);
});

test("layout: other, own files and extras get their own tiles", () => {
  const page = listing([row(1, 500)], {
    other: { count: 12, bytes: 100 },
    ownFiles: { bytes: 50, count: 3 },
  });
  const tiles = layoutPage(page, RECT, { extras: [{ kind: "gap", name: "not in files", bytes: 80 }] });
  assert.deepEqual(tiles.map((t) => t.kind).sort(), ["files", "folder", "gap", "other"]);
  assert.equal(tiles.find((t) => t.kind === "other").name, "12 more");
  assert.equal(tiles.find((t) => t.kind === "gap").name, "not in files");
});

test("layout: a parent too small to hold its children is not nested", () => {
  const page = listing([
    row(1, 1e9),
    row(2, 1, { hasKids: true, kids: listing([row(3, 1)]) }),
  ]);
  const tiles = layoutPage(page, { x: 0, y: 0, w: 300, h: 200 });
  assert.equal(tiles.find((t) => t.id === 2).nested, false);
  assert.equal(tiles.filter((t) => t.depth === 2).length, 0);
});

test("layout: zero-byte children and an empty page give no tiles", () => {
  assert.deepEqual(layoutPage(listing([row(1, 0)]), RECT), []);
  assert.deepEqual(layoutPage(listing([]), RECT), []);
});

test("label: fits whole, cuts with an ellipsis, or gives up", () => {
  assert.equal(fitLabel("node_modules", 200, 30), "node_modules");
  const cut = fitLabel("a_very_long_folder_name", 70, 30);
  assert.ok(cut.endsWith("…"));
  assert.ok(cut.length <= 8);
  assert.equal(fitLabel("abc", 20, 30), null, "too narrow");
  assert.equal(fitLabel("abc", 200, 8), null, "too short");
});

test("tone: junk kinds map to risk colours, the rest is still", () => {
  const t = (over) => ({ kind: "folder", depth: 1, ...over });
  assert.equal(toneOf(t({ junk: "cache-safe" })), "safe");
  assert.equal(toneOf(t({ junk: "name-hit" })), "safe");
  assert.equal(toneOf(t({ junk: "cache-caution" })), "caution");
  assert.equal(toneOf(t({ junk: "refused" })), "refused");
  assert.equal(toneOf(t({ junk: null })), "still");
  assert.equal(toneOf({ kind: "other", depth: 1 }), "still");
});

test("select: refused, locked and non-folder tiles cannot be picked", () => {
  assert.equal(selectable({ kind: "folder" }), true);
  assert.equal(selectable({ kind: "folder", junk: "refused" }), false);
  assert.equal(selectable({ kind: "folder", locked: "too close to drive root" }), false);
  assert.equal(selectable({ kind: "other" }), false);
});

test("class: tone, depth, lock and selection", () => {
  assert.equal(
    tileClass({ kind: "folder", depth: 2, junk: "cache-caution" }, { selected: true }),
    "map-tile map-tile--caution map-tile--d2 is-selected",
  );
  assert.equal(
    tileClass({ kind: "gap", depth: 1 }),
    "map-tile map-tile--still map-tile--d1 map-tile--gap map-tile--locked",
  );
});

test("strip: a still tile shows its junk share by risk; a junk tile shows none", () => {
  assert.deepEqual(junkShare({ kind: "folder", bytes: 200, junkBytes: 50 }), { safe: 0.25, caution: 0 });
  assert.deepEqual(
    junkShare({ kind: "folder", bytes: 200, junkBytes: 100, cautionBytes: 20 }),
    { safe: 0.4, caution: 0.1 },
  );
  const none = { safe: 0, caution: 0 };
  assert.deepEqual(junkShare({ kind: "folder", bytes: 200, junkBytes: 200, junk: "name-hit" }), none);
  assert.deepEqual(junkShare({ kind: "folder", bytes: 0, junkBytes: 0 }), none);
});
