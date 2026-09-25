/**
 * The real data source: the riptide Vite plugin's endpoints. See
 * context.js for the seam this module fills.
 */
const BASE = "/__riptide";

/** The real backend can do everything the UI offers. */
export const caps = {
  demo: false,
  directoryPicker: true,
  settings: true,
  leaveGuard: true,
  permanent: true,
  fullRescan: true,
  window: false,
};

export async function getRoots() {
  const res = await fetch(`${BASE}/roots`);
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()).roots;
}

/** The immediate subdirectories of `path`, for the browse dialog. */
export async function getDirs(path, { signal } = {}) {
  const res = await fetch(`${BASE}/dirs?path=${encodeURIComponent(path)}`, { signal });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

/**
 * Stream a scan. Calls onProgress for each progress line and resolves with
 * the final result. Aborting the signal drops the connection, which stops
 * the server's work too. full reads the whole MFT instead of updating the
 * drive's kept tree from the change journal.
 */
export function scan({ root, patterns, full = false, onProgress, signal }) {
  return streamNdjson("/scan", { root, patterns, full }, onProgress, signal);
}

/**
 * POST a request whose response is a stream of JSON lines: any number of
 * progress notes, then exactly one line of type "done". An aborted signal
 * rejects with an AbortError at whatever point the stream had reached.
 */
async function streamNdjson(endpoint, payload, onProgress, signal) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw new Error(await errorText(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const note = JSON.parse(line);
      if (note.type === "done") final = note;
      else onProgress?.(note);
    }
  }

  if (!final) {
    throw new Error(`${endpoint} ended without a result — the server may have died`);
  }
  return final;
}

/**
 * Ask for a plan: paths to delete and action ids to run. The server keeps
 * only what its scans offered.
 */
export async function plan(paths, bytes, actions = []) {
  const res = await fetch(`${BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, actions, bytes }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

/**
 * Stream a ripgrep search. onFile fires per matching file as results
 * arrive, so the list fills in rather than appearing all at once.
 */
export function grep(options, onFile, signal) {
  return streamNdjson(
    "/grep",
    options,
    (note) => {
      if (note.type === "file") onFile(note);
    },
    signal,
  );
}

/**
 * Enumerate caches from the loaded packs, skipping any disabled ids.
 * full reads each drive's whole MFT instead of updating a kept tree.
 */
export function caches({ disabled, root, full = false }, onProgress, signal) {
  return streamNdjson("/caches", { disabled, root, full }, onProgress, signal);
}

/** Every known cache config, enabled or not, for the settings modal. */
export async function cacheConfigs() {
  const res = await fetch(`${BASE}/cache-configs`);
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

/**
 * Read a whole drive into a space map. patterns and disabled are the Zap
 * and Caches tabs' settings, which decide what the map marks as junk.
 * Resolves with the snapshot's name.
 */
export function mapRead({ root, patterns, disabled, full = false }, onProgress, signal) {
  return streamNdjson("/map/read", { root, patterns, disabled, full }, onProgress, signal);
}

/**
 * One page of a space map. A map that changed since `gen` rejects with an
 * error carrying `stale: {gen, read}`, so the caller can re-root.
 */
export async function mapNode({ drive, gen, id, depth = 2, limit = 40 }, { signal } = {}) {
  const q = new URLSearchParams({ drive, gen, id, depth, limit });
  const res = await fetch(`${BASE}/map/node?${q}`, { signal });
  if (res.status === 409) {
    const body = await res.json();
    throw Object.assign(new Error(body.error), { stale: { gen: body.gen, read: body.read } });
  }
  if (!res.ok) throw Object.assign(new Error(await errorText(res)), { status: res.status });
  return res.json();
}

/**
 * Offer folders picked on a map for deletion. Resolves with
 * {paths, items, bytes, refused}; a stale gen rejects like mapNode.
 */
export async function mapOffer({ drive, gen, recNos }) {
  const res = await fetch(`${BASE}/map/offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drive, gen, recNos }),
  });
  if (res.status === 409) {
    const body = await res.json();
    throw Object.assign(new Error(body.error), { stale: { gen: body.gen, read: body.read } });
  }
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

/**
 * Send the server-side settings; resolves with what the server now holds:
 * {keepDrives, bytesPerDrive}. bytesPerDrive is null until a drive is read.
 */
export async function putSettings({ keepDrives }) {
  const res = await fetch(`${BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keepDrives }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

/** The server-side settings, as putSettings resolves them. */
export async function getSettings() {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export function zap({ token, permanent, confirmCount, onProgress }) {
  return streamNdjson("/zap", { token, permanent, confirmCount }, onProgress);
}

async function errorText(res) {
  try {
    return (await res.json()).error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
