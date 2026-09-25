/**
 * Tests for the dialog focus trap.
 *
 *   node --test src/ui/focusTrap.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { trapTarget } from "./focusTrap.js";

test("Tab on the last stop wraps to the first", () => {
  assert.equal(trapTarget(3, 2, false), 0);
});

test("Shift+Tab on the first stop wraps to the last", () => {
  assert.equal(trapTarget(3, 0, true), 2);
});

test("Tab in the middle is left to the browser", () => {
  assert.equal(trapTarget(3, 1, false), null);
  assert.equal(trapTarget(3, 1, true), null);
});

test("from the dialog box itself, Tab goes to the first stop and Shift+Tab to the last", () => {
  assert.equal(trapTarget(3, -1, false), 0);
  assert.equal(trapTarget(3, -1, true), 2);
});

test("a dialog with no stops keeps focus on itself", () => {
  assert.equal(trapTarget(0, -1, false), -1);
});
