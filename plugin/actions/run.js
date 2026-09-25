/**
 * Run an action: its steps one after another, each a spawned process.
 *
 * A step is {exe, args, timeoutMs, label?, stdin?, failPattern?}.
 *
 *   stdin        text written to the child's standard input, which is then
 *                closed. Nothing is written to disk.
 *   failPattern  an output line matching it fails the step whatever the
 *                exit code. diskpart reading stdin reports an error in its
 *                output and still exits 0.
 *   critical     once started, the step runs to the end: no abort and no
 *                timeout kills it. Killing DISM or diskpart midway can
 *                leave the system or a disk in a bad state.
 *   keepGoing    a failure does not stop the steps after it (see runAction)
 *   cleanup      a step run after this one fails for any reason: error,
 *                kill, timeout. It runs even after an abort. Its outcome
 *                does not change the failure reported.
 *
 * Output arrives as lines. Exit code 0 is success; any other code, a spawn
 * error, a timeout or an abort is failure, and the steps after it do not
 * run. A timeout or an abort kills the child.
 */

import path from "node:path";

/**
 * Run an action's steps in order.
 *
 * `preflight`, when the action has one, is asked just before the first
 * step; a reason it returns refuses the run. A failed step ends the run,
 * unless it is marked `keepGoing`: then its result is reported as a line
 * and the next step runs, and the action fails at the end if any did.
 *
 * @param {{id: string, steps: (ctx: object) => Promise<object[]>,
 *          preflight?: (ctx: object) => Promise<string|null>}} action
 * @param {{spawn: Function}} ctx
 * @param {{onLine?: (note: {id: string, line: string}) => void,
 *          onStep?: (note: {id: string, label: string, critical: boolean}) => void,
 *          signal?: AbortSignal}} [opts]
 *   onStep fires as each step starts
 * @returns {Promise<{id: string, ok: boolean, error?: string}>}
 */
export async function runAction(action, ctx, { onLine = () => {}, onStep = () => {}, signal } = {}) {
  const fail = (error) => ({ id: action.id, ok: false, error });
  let steps;
  try {
    steps = await action.steps(ctx);
    const refused = action.preflight ? await action.preflight(ctx) : null;
    if (refused) return fail(refused);
  } catch (err) {
    return fail(err.message);
  }

  const line = (text) => onLine({ id: action.id, line: text });
  const independent = steps.filter((s) => s.keepGoing).length;
  let failed = 0;

  for (const step of steps) {
    const label = commandText(step);
    if (!signal?.aborted) onStep({ id: action.id, label, critical: step.critical === true });
    const result = await runStep(step, { spawn: ctx.spawn, onLine: line, signal });
    if (!step.keepGoing) {
      if (!result.ok) return fail(result.error);
      continue;
    }
    line(result.ok ? `${label}: ok` : `${label}: failed — ${result.error}`);
    if (!result.ok) failed += 1;
  }
  return failed > 0 ? fail(`${failed} of ${independent} failed`) : { id: action.id, ok: true };
}

/**
 * Run one step and wait for it.
 *
 * @param {{exe: string, args: string[], timeoutMs: number, stdin?: string,
 *          failPattern?: RegExp}} step
 * @param {{spawn: Function, onLine?: (line: string, stream: "stdout"|"stderr") => void,
 *          signal?: AbortSignal}} opts
 * @returns {Promise<{ok: boolean, code?: number|null, error?: string}>}
 */
export async function runStep(step, { spawn, onLine = () => {}, signal }) {
  if (signal?.aborted) return { ok: false, error: "stopped" };
  const result = await spawnStep(step, { spawn, onLine, signal });
  // No signal: a cleanup is what an abort most needs.
  if (!result.ok && step.cleanup) await spawnStep(step.cleanup, { spawn, onLine, signal: undefined });
  return result;
}

/**
 * Run a read-only probe and keep its standard output.
 *
 * @returns {Promise<{ok: boolean, code?: number|null, error?: string, stdout: string[]}>}
 */
export async function capture(spawn, step, { signal } = {}) {
  const stdout = [];
  const result = await runStep(step, {
    spawn,
    signal,
    onLine: (line, stream) => {
      if (stream === "stdout") stdout.push(line);
    },
  });
  return { ...result, stdout };
}

/**
 * What a step looks like to a person: its label, or the program name and
 * its arguments.
 *
 * @param {{exe: string, args: string[], label?: string}} step
 * @returns {string}
 */
export function commandText(step) {
  if (step.label) return step.label;
  const name = path.win32.basename(step.exe).replace(/\.exe$/i, "");
  return [name, ...step.args].join(" ");
}

/**
 * Split a byte stream into trimmed, non-empty lines. \r counts as a line
 * end too: dism and docker redraw a progress line with it.
 *
 * @param {(line: string) => void} onLine
 * @returns {{push: (chunk: Buffer|string) => void, flush: () => void}}
 */
export function createLineSplitter(onLine) {
  const decoder = new TextDecoder();
  let rest = "";

  const emit = (text) => {
    const line = text.trimEnd();
    if (line.trim()) onLine(line.slice(0, MAX_LINE));
  };

  return {
    push(chunk) {
      rest += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const lines = rest.split(/\r\n|\r|\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) emit(line);
    },
    flush() {
      rest += decoder.decode();
      emit(rest);
      rest = "";
    },
  };
}

const MAX_LINE = 400;

// ---------------------------------------------------------------------------

function spawnStep(step, { spawn, onLine, signal }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(step.exe, step.args);
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }

    let settled = false;
    // Why we killed the child, once we have.
    let killedFor = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const kill = (reason) => {
      if (killedFor) return;
      killedFor = reason;
      child.kill();
    };
    const onAbort = () => kill("stopped");

    // A critical step is left to finish, whatever happens around it.
    const timer = step.critical
      ? null
      : setTimeout(() => kill(`timed out after ${formatMs(step.timeoutMs)}`), step.timeoutMs);
    if (!step.critical) signal?.addEventListener("abort", onAbort, { once: true });

    // A child that exits before reading all of it closes the pipe; that is
    // its exit code's story, not an error here.
    child.stdin?.on("error", () => {});
    child.stdin?.end(step.stdin ?? "");

    // The first output line that says the step failed, when it has a pattern.
    let reported = null;
    const see = (stream) => (line) => {
      if (!reported && step.failPattern?.test(line)) reported = line;
      onLine(line, stream);
    };
    const out = createLineSplitter(see("stdout"));
    const err = createLineSplitter(see("stderr"));
    child.stdout?.on("data", out.push);
    child.stderr?.on("data", err.push);

    child.on("error", (e) => finish({ ok: false, error: e.message }));
    child.on("close", (code) => {
      out.flush();
      err.flush();
      if (killedFor) finish({ ok: false, code, error: killedFor });
      else if (reported) finish({ ok: false, code, error: reported });
      else if (code === 0) finish({ ok: true, code });
      else if (code === null) finish({ ok: false, code, error: "ended without an exit code" });
      else finish({ ok: false, code, error: `exit code ${code}` });
    });
  });
}

function formatMs(ms) {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 1000)} s`;
}
