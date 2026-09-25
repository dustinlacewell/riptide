/**
 * Tests for row-painting semantics.
 *
 * The hook's event plumbing needs React, but its decisions do not: pressRow
 * and crossRow are the real functions the hook calls, driven here over a
 * plain set of checked paths.
 *
 *   node --test src/painter.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { pressRow, crossRow } from "./useRowPainter.js";

/** Drives the real decision functions over a set of checked paths. */
function painter(initiallyChecked) {
  const checked = new Set(initiallyChecked);
  let stroke = null;

  const set = (path, on) => (on ? checked.add(path) : checked.delete(path));

  return {
    press(path, { shift = false } = {}) {
      const decision = pressRow(checked.has(path), shift);
      set(path, decision.checked);
      stroke = decision.stroke
        ? { checked: decision.checked, seen: new Set([path]) }
        : null;
    },
    enter(path) {
      const decision = crossRow(stroke, path);
      if (!decision.paint) return;
      stroke.seen.add(path);
      set(path, decision.checked);
    },
    release() {
      stroke = null;
    },
    get checked() {
      return [...checked].sort();
    },
    get painting() {
      return stroke !== null;
    },
  };
}

test("a press toggles the row it lands on", () => {
  const p = painter(["a"]);
  p.press("a");
  assert.deepEqual(p.checked, [], "checked row becomes unchecked");
  p.press("a");
  assert.deepEqual(p.checked, ["a"], "and back again");
});

test("a press without shift starts no stroke", () => {
  const p = painter([]);
  p.press("a");
  assert.equal(p.painting, false);
  p.enter("b");
  assert.deepEqual(p.checked, ["a"], "crossing b does nothing");
});

test("shift-drag from a checked row unchecks everything it crosses", () => {
  const p = painter(["a", "b", "c"]);
  p.press("a", { shift: true });
  p.enter("b");
  p.enter("c");
  assert.deepEqual(p.checked, []);
});

test("shift-drag from an unchecked row checks everything it crosses", () => {
  const p = painter([]);
  p.press("a", { shift: true });
  p.enter("b");
  p.enter("c");
  assert.deepEqual(p.checked, ["a", "b", "c"]);
});

test("a stroke paints one state, it does not flip each row", () => {
  // The point of the gesture: dragging across a mixed selection makes it
  // uniform. Flipping each row instead would just invert the mess.
  const p = painter(["b"]);
  p.press("a", { shift: true }); // a was unchecked, so the stroke checks
  p.enter("b");                  // already checked, stays checked
  p.enter("c");
  assert.deepEqual(p.checked, ["a", "b", "c"]);
});

test("re-crossing a row during one stroke does not flip it back", () => {
  // Dragging down and back up passes the same rows twice.
  const p = painter([]);
  p.press("a", { shift: true });
  p.enter("b");
  p.enter("c");
  p.enter("b");
  p.enter("a");
  assert.deepEqual(p.checked, ["a", "b", "c"]);
});

test("releasing ends the stroke", () => {
  const p = painter([]);
  p.press("a", { shift: true });
  p.enter("b");
  p.release();
  p.enter("c");
  assert.deepEqual(p.checked, ["a", "b"], "c is not painted after release");
});

test("a new stroke takes its state from its own first row", () => {
  const p = painter([]);
  p.press("a", { shift: true }); // checks
  p.enter("b");
  p.release();

  p.press("a", { shift: true }); // a is now checked, so this stroke unchecks
  p.enter("b");
  assert.deepEqual(p.checked, []);
});
