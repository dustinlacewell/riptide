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
 *
 * Output arrives as lines. Exit code 0 is success; any other code, a spawn
 * error, a timeout or an abort is failure, and the steps after it do not
 * run. A timeout or an abort kills the child.
 */

import path from "node:path";

/**
 * @param {{id: string, steps: (ctx: object) => Promise<object[]>}} action
 * @param {{spawn: Function}} ctx
 * @param {{onLine?: (note: {id: string, line: string}) => void,
 *          signal?: AbortSignal}} [opts]
 * @returns {Promise<{id: string, ok: boolean, error?: string}>}
 */
export async function runAction(action, ctx, { onLine = () => {}, signal } = {}) {
  let steps;
  try {
    steps = await action.steps(ctx);
  } catch (err) {
    return { id: action.id, ok: false, error: err.message };
  }

  for (const step of steps) {
    const result = await runStep(step, {
      spawn: ctx.spawn,
      onLine: (line) => onLine({ id: action.id, line }),
      signal,
    });
    if (!result.ok) return { id: action.id, ok: false, error: result.error };
  }
  return { id: action.id, ok: true };
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
  return spawnStep(step, { spawn, onLine, signal });
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

    const timer = setTimeout(
      () => kill(`timed out after ${formatMs(step.timeoutMs)}`),
      step.timeoutMs,
    );
    signal?.addEventListener("abort", onAbort, { once: true });

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
