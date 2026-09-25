const BASE = "/__riptide";

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
 * the final result.
 */
export function scan({ root, patterns, onProgress }) {
  return streamNdjson("/scan", { root, patterns }, onProgress);
}

/**
 * POST a request whose response is a stream of JSON lines: any number of
 * progress notes, then exactly one line of type "done".
 */
async function streamNdjson(endpoint, payload, onProgress) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

export async function plan(paths, bytes) {
  const res = await fetch(`${BASE}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, bytes }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

/**
 * Stream a ripgrep search. onFile fires per matching file as results
 * arrive, so the list fills in rather than appearing all at once.
 */
export function grep(options, onFile) {
  return streamNdjson("/grep", options, (note) => {
    if (note.type === "file") onFile(note);
  });
}

/** Enumerate caches from the loaded packs, skipping any disabled ids. */
export function caches({ disabled, root }, onProgress) {
  return streamNdjson("/caches", { disabled, root }, onProgress);
}

/** Every known cache config, enabled or not, for the settings modal. */
export async function cacheConfigs() {
  const res = await fetch(`${BASE}/cache-configs`);
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
