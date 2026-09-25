/**
 * The demo's timelines: the notes each real endpoint streams, with the
 * waits between them. Pure: every builder takes the data it reports and
 * returns a script for player.js.
 *
 * Every progress note carries type "progress", as the server sends it.
 */

export const RECORDS_TOTAL = 4_870_000;
const RECORD_BYTES = 1024;

/**
 * A whole-MFT read: reading-mft, the header, a stream note every `every`
 * ms for `ms`, then mft-done. The per-note step wobbles so the rate the
 * telemetry shows moves the way a real read's does.
 */
export function mftRead({ drive = "C:", ms = 4800, every = 120, matches = null } = {}) {
  const count = Math.max(1, Math.round(ms / every));
  const weights = Array.from({ length: count }, (_, i) => 1 + 0.45 * Math.sin(i * 1.3) * Math.cos(i * 0.4));
  const sum = weights.reduce((a, b) => a + b, 0);

  const steps = [
    { dt: 0, note: progress("reading-mft", { drive, driveIndex: 1, driveCount: 1 }) },
    { dt: 180, note: progress("mft-header", { recordsTotal: RECORDS_TOTAL, mftBytes: RECORDS_TOTAL * RECORD_BYTES }) },
  ];
  let done = 0;
  weights.forEach((w, i) => {
    done += w;
    const recordsDone = i === count - 1 ? RECORDS_TOTAL : Math.round((RECORDS_TOTAL * done) / sum);
    steps.push({
      dt: every,
      note: progress("mft-stream", {
        recordsDone,
        recordsTotal: RECORDS_TOTAL,
        bytesRead: recordsDone * RECORD_BYTES,
        ...(matches === null ? {} : { matches: Math.round((matches * recordsDone) / RECORDS_TOTAL) }),
      }),
    });
  });
  steps.push({ dt: 40, note: progress("mft-done", { recordsDone: RECORDS_TOTAL, recordsTotal: RECORDS_TOTAL, readMs: ms }) });
  return steps;
}

/** /scan: the read, index, size, then the hits. */
export function scanScript(hits, { now }) {
  const started = now();
  const read = mftRead({ matches: hits.length });
  return {
    steps: [...read, { dt: 260, note: progress("index") }, { dt: 380, note: progress("size") }, { dt: 320 }],
    done: () => ({
      type: "done",
      strategy: "mft",
      reason: null,
      elapsedMs: now() - started,
      stats: { records: RECORDS_TOTAL, readMs: 4800, indexMs: 260, sizeMs: 700, how: "full", changes: 0 },
      hits,
    }),
  };
}

/**
 * /caches: the actions note early, as the server lists them alongside the
 * read; then the read, and one found note per batch.
 */
export function cachesScript({ actions, packs, batches }, { now }) {
  const started = now();
  const read = mftRead({ ms: 3600 });
  const steps = [read[0], { dt: 90, note: { type: "actions", actions, packs } }, ...read.slice(1)];
  steps.push({ dt: 220, note: progress("index", { drive: "C:", driveIndex: 1, driveCount: 1 }) });
  steps.push({ dt: 300, note: progress("size", { drive: "C:", driveIndex: 1, driveCount: 1 }) });
  batches.forEach((found, i) => {
    if (found.length > 0) steps.push({ dt: i === 0 ? 240 : 420, note: { type: "found", found, packs } });
  });
  steps.push({ dt: 120 });
  return { steps, done: () => ({ type: "done", errors: [], elapsedMs: now() - started }) };
}

/** /map/read: the read, junk and compact, then `done()` publishes the map. */
export function mapReadScript(done) {
  return {
    steps: [...mftRead({ ms: 3000 }), { dt: 300, note: progress("junk") }, { dt: 260, note: progress("compact") }, { dt: 140 }],
    done,
  };
}

/** /grep: one file note at a time, then the summary. */
export function grepScript(files, { now }) {
  const started = now();
  return {
    steps: files.map((file, i) => ({ dt: 70 + ((i * 53) % 90), note: file })),
    done: () => ({ type: "done", files: files.length, truncated: false, elapsedMs: now() - started }),
  };
}

/**
 * /zap: one result per path 60-90 ms apart, then each action's run, then
 * the done line.
 *
 * @param {{paths: string[], actions: object[], permanent: boolean,
 *          failOf: (path: string) => string|null, lines: string[]}} plan
 */
export function zapScript({ paths, actions, permanent, failOf, lines }, { now }) {
  const started = now();
  const results = paths.map((path) => {
    const error = failOf(path);
    return error ? { path, ok: false, error } : { path, ok: true };
  });
  const steps = results.map((r, i) => ({
    dt: 60 + ((i * 37) % 31),
    note: { type: "progress", ...r, done: i + 1, total: paths.length },
  }));
  for (const a of actions) {
    steps.push({ dt: 120, note: { type: "action", id: a.id, status: "running" } });
    steps.push({ dt: 60, note: { type: "action", id: a.id, step: a.commands[0], critical: false } });
    for (const line of lines) steps.push({ dt: 280, note: { type: "action", id: a.id, line } });
    steps.push({ dt: 200, note: { type: "action", id: a.id, status: "ok" } });
  }
  return {
    steps,
    done: () => ({
      type: "done",
      permanent,
      elapsedMs: now() - started,
      deleted: results.filter((r) => r.ok).map((r) => r.path),
      failed: results.filter((r) => !r.ok),
      actions: actions.map((a) => ({ id: a.id, ok: true })),
    }),
  };
}

function progress(stage, fields = {}) {
  return { type: "progress", stage, ...fields };
}
