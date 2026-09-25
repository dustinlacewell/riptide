/**
 * A stand-in spawner for tests. Nothing it is given ever runs.
 *
 * `respond(exe, args)` says what the fake process does:
 *
 *   {stdout?: string[], stderr?: string[], code?: number}  write, then exit
 *   {hang: true}   write, then wait until killed
 *   {error: Error} fail to start, as a missing program does
 *
 * Each call is recorded in `calls`, with `killed` set when it is killed and
 * `stdin` holding what was written to it.
 */

import { EventEmitter } from "node:events";

export function createFakeSpawn(respond = () => ({ code: 0 })) {
  const calls = [];

  function spawn(exe, args) {
    const plan = respond(exe, args) ?? { code: 0 };
    const call = { exe, args: [...args], killed: false, stdin: "" };
    calls.push(call);

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = (text = "") => {
      call.stdin += text;
    };
    let closed = false;
    const close = (code) => {
      if (closed) return;
      closed = true;
      child.emit("close", code);
    };
    child.kill = () => {
      call.killed = true;
      setImmediate(() => close(null));
      return true;
    };

    setImmediate(() => {
      if (plan.error) {
        child.emit("error", plan.error);
        return;
      }
      for (const text of plan.stdout ?? []) child.stdout.emit("data", Buffer.from(text));
      for (const text of plan.stderr ?? []) child.stderr.emit("data", Buffer.from(text));
      if (!plan.hang) close(plan.code ?? 0);
    });

    return child;
  }

  return { spawn, calls };
}
