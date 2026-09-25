/**
 * Play a scripted timeline: wait each step's dt, emit its note, and resolve
 * with the script's done value.
 *
 * Pure apart from the injected sleep. A test passes instantSleep and the
 * whole script runs in one tick; the demo passes realSleep.
 *
 *   script   {steps: Array<{dt: number, note?: object}>, done: value | () => value}
 *            done as a function is read when the last step has played, so
 *            it can report elapsed time or apply the run's effects
 *   signal   an abort rejects with DOMException("AbortError"), the same
 *            rejection a stopped fetch gives
 */
export async function play({ steps, done }, emit, { sleep, signal } = {}) {
  for (const step of steps) {
    stopIfAborted(signal);
    if (step.dt > 0) await sleep(step.dt, signal);
    stopIfAborted(signal);
    if (step.note !== undefined) emit?.(step.note);
  }
  stopIfAborted(signal);
  return typeof done === "function" ? done() : done;
}

/** A timer that an abort cuts short. */
export function realSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const instantSleep = async () => {};

export function abortError() {
  return new DOMException("The demo run was stopped", "AbortError");
}

function stopIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}
