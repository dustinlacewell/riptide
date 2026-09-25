import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What a press on a row does.
 *
 * @param {boolean} wasChecked the row's state before the press
 * @param {boolean} shift whether shift was held
 * @returns {{checked: boolean, stroke: boolean}} the row's new state, and
 *          whether this press begins a painting stroke
 */
export function pressRow(wasChecked, shift) {
  const checked = !wasChecked;
  return { checked, stroke: shift };
}

/**
 * Whether crossing a row mid-stroke should change it.
 *
 * A stroke paints one state onto everything it touches, decided at the
 * press. It never flips per row — that would only invert a mixed selection
 * instead of making it uniform — and it never repaints a row it has already
 * crossed, so dragging back over your own path is harmless.
 *
 * @param {{checked: boolean, seen: Set<string>}|null} stroke
 * @param {string} path
 * @returns {{paint: boolean, checked?: boolean}}
 */
export function crossRow(stroke, path) {
  if (!stroke || stroke.seen.has(path)) return { paint: false };
  return { paint: true, checked: stroke.checked };
}

/**
 * Click-to-toggle rows, with shift-drag to paint.
 *
 * A plain click flips one row. Holding shift and dragging applies the first
 * row's *resulting* state to every row crossed — press on a checked row and
 * you uncheck the whole sweep, press on an unchecked row and you check it.
 * That is what makes a drag predictable: the state is decided once, at the
 * start, rather than flipping each row it meets.
 *
 * @param {(paths: string[], checked: boolean) => void} apply
 * @param {(path: string) => boolean} isChecked
 */
export function useRowPainter(apply, isChecked) {
  // A ref, not state: pointermove fires far faster than React can re-render,
  // and the stroke must not depend on a committed render to stay correct.
  const stroke = useRef(null);
  const [painting, setPainting] = useState(false);

  const stop = useCallback(() => {
    stroke.current = null;
    setPainting(false);
  }, []);

  // The stroke ends wherever the pointer is released, including outside the
  // table or the window, so this listens globally rather than on the row.
  useEffect(() => {
    if (!painting) return;
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [painting, stop]);

  const onPointerDown = useCallback(
    (event, path) => {
      // Let the checkbox and any control inside the row do their own thing.
      if (event.target.closest("input, button, a, label")) return;
      if (event.button !== 0) return;

      event.preventDefault(); // suppress the text selection a drag would start

      const { checked, stroke: begins } = pressRow(isChecked(path), event.shiftKey);
      apply([path], checked);

      if (begins) {
        stroke.current = { checked, seen: new Set([path]) };
        setPainting(true);
      }
    },
    [apply, isChecked],
  );

  const onPointerEnter = useCallback(
    (path) => {
      const decision = crossRow(stroke.current, path);
      if (!decision.paint) return;
      stroke.current.seen.add(path);
      apply([path], decision.checked);
    },
    [apply],
  );

  return { onPointerDown, onPointerEnter, painting };
}
