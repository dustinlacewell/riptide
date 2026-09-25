import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion.js";
import { tweenValue } from "./tween.js";

/**
 * A number that counts toward `target` over `duration` ms, one step per
 * animation frame.
 *
 * A change of target counts from the value on screen. A change of
 * `replayKey` — and the first render — counts from 0. Under
 * prefers-reduced-motion the value jumps straight to the target.
 *
 * @param {number} target
 * @param {number} duration ms
 * @param {unknown} [replayKey]
 * @returns {number}
 */
export function useTween(target, duration, replayKey) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  const lastKey = useRef(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    const replay = !mounted.current || lastKey.current !== replayKey;
    mounted.current = true;
    lastKey.current = replayKey;

    const from = replay ? 0 : current.current;
    const show = (v) => {
      current.current = v;
      setShown(v);
    };

    if (duration <= 0 || reducedMotion() || from === target) {
      show(target);
      return undefined;
    }

    let frame = 0;
    const start = performance.now();
    const step = (now) => {
      show(tweenValue(from, target, now - start, duration));
      if (now - start < duration) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, replayKey]);

  return shown;
}
