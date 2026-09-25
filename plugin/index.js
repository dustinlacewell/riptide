/**
 * vite-plugin-riptide
 *
 * The dev server is the backend. configureServer gives us a Node process
 * with full fs access, so we hang the API off its middleware stack. One
 * `npm run dev`, one process.
 */

import os from "node:os";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { scanVolume } from "./mft/scan.js";
import { listDirs } from "./dirs.js";
import { loadPacks } from "./caches/load.js";
import { resolveEntries } from "./caches/resolve.js";
import { whereOf } from "./caches/pack.js";
import { screenPaths, zapPaths } from "./zap.js";
import { createOffered } from "./offered.js";
import { buildPlan } from "./plan.js";
import { runRipgrep } from "./grep/run.js";
import { parseGlobs } from "./grep/args.js";
import { driveOf } from "./caches/expand.js";
import { createMapStore } from "./map/store.js";
import { readMap } from "./map/read.js";
import { childrenPage } from "./map/page.js";
import { identifyFolder } from "./map/identify.js";
import { offerPicks } from "./map/offer.js";

const BASE = "/__riptide";

/**
 * Every path a scan has streamed to the client. /plan accepts only these.
 */
const offered = createOffered();

/**
 * Plans are held server-side and referenced by token, so the zap endpoint
 * never takes a raw path list from the client. What gets deleted is exactly
 * what was screened and shown.
 */
const plans = new Map();
const PLAN_TTL_MS = 10 * 60 * 1000;

/** Space-map snapshots, one per drive, held between requests. */
const maps = createMapStore();

export default function riptide() {
  return {
    name: "vite-plugin-riptide",
    configureServer(server) {
      server.middlewares.use(BASE, async (req, res) => {
        try {
          await route(req, res);
        } catch (err) {
          json(res, 500, { error: err.message });
        }
      });
    },
  };
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/roots") {
    return json(res, 200, { roots: await listRoots() });
  }
  if (req.method === "GET" && url.pathname === "/dirs") {
    return dirsRoute(url, res);
  }
  if (req.method === "GET" && url.pathname === "/cache-configs") {
    return cacheConfigsRoute(res);
  }
  if (req.method === "POST" && url.pathname === "/caches") {
    return cachesRoute(req, res);
  }
  if (req.method === "POST" && url.pathname === "/scan") {
    return scanRoute(req, res);
  }
  if (req.method === "POST" && url.pathname === "/grep") {
    return grepRoute(req, res);
  }
  if (req.method === "POST" && url.pathname === "/plan") {
    return planRoute(req, res);
  }
  if (req.method === "POST" && url.pathname === "/zap") {
    return zapRoute(req, res);
  }
  if (req.method === "POST" && url.pathname === "/map/read") {
    return mapReadRoute(req, res);
  }
  if (req.method === "GET" && url.pathname === "/map/node") {
    return mapNodeRoute(url, res);
  }
  if (req.method === "POST" && url.pathname === "/map/offer") {
    return mapOfferRoute(req, res);
  }

  json(res, 404, { error: "no such endpoint" });
}

// ---------------------------------------------------------------------------

async function dirsRoute(url, res) {
  const target = url.searchParams.get("path");

  if (!target) {
    return json(res, 400, { error: "path is required" });
  }

  try {
    return json(res, 200, await listDirs(target));
  } catch (err) {
    // A path the user typed or a drive that went away is a bad request, not
    // a server fault — the picker shows the message and stays open.
    if (err.code === "ENOTDIR") return json(res, 400, { error: err.message });
    throw err;
  }
}

/**
 * Every known cache config, whether enabled or not — the settings modal
 * needs the full list to offer toggles for the disabled ones.
 */
async function cacheConfigsRoute(res) {
  const { entries, packs, errors } = await loadPacks();

  json(res, 200, {
    packs,
    errors,
    configs: entries.map((e) => ({
      id: e.id,
      label: e.label,
      tool: e.tool,
      pack: e.pack,
      cost: e.cost,
      risk: e.risk,
      riskNote: e.riskNote,
      // What the entry looks for, so the modal can show where it searches.
      where: whereOf(e),
      perProject: e.perProject,
    })),
  });
}

async function cachesRoute(req, res) {
  // First, before any await: a client that leaves while the body or the
  // packs load must still cancel the run.
  const signal = abortOnDisconnect(res);

  const { disabled, root } = await body(req);
  if (signal.aborted) return;
  const { entries: all, packs, errors } = await loadPacks();
  if (signal.aborted) return;

  // Filtering here rather than in the UI means a disabled per-project rule
  // costs no MFT work at all, which is the expensive part.
  const off = new Set(Array.isArray(disabled) ? disabled : []);
  const entries = all.filter((e) => !off.has(e.id));

  // A new cache scan replaces the last one's offer.
  offered.clear("caches");

  if (entries.length === 0) {
    return json(res, 200, { found: [], packs, errors, sized: false });
  }

  // Streamed: reading a drive's MFT takes long enough that the UI should
  // show what stage it is at rather than hang.
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
  });

  const started = Date.now();
  const { drives } = await listRoots();
  if (signal.aborted) return;

  try {
    const result = await resolveEntries(entries, {
      drives,
      signal,
      // With a root, only its drive is read and only hits under it are kept.
      root: typeof root === "string" && root.trim() ? root : null,
      onProgress: (note) =>
        res.write(JSON.stringify({ type: "progress", ...note }) + "\n"),
      // One message per drive, carrying sized results. Nothing is reported
      // before its size is known — an unsized row is not actionable.
      onFound: (found) => {
        offered.add(found.map((hit) => hit.path), "caches");
        res.write(JSON.stringify({ type: "found", found, packs }) + "\n");
      },
    });

    res.write(
      JSON.stringify({
        type: "done",
        errors: [...errors, ...result.errors],
        elapsedMs: Date.now() - started,
      }) + "\n",
    );
  } catch (err) {
    // The client stopped the run and is no longer listening.
    if (signal.aborted) return;
    res.write(
      // A crash here is a fault in the scan, not a malformed pack. Reporting
      // it under "pack issues" sends anyone debugging to the wrong place.
      JSON.stringify({
        type: "done",
        found: [],
        packs,
        errors,
        failure: err.message,
      }) + "\n",
    );
  }

  res.end();
}

async function scanRoute(req, res) {
  const signal = abortOnDisconnect(res);

  const { root, patterns } = await body(req);
  if (signal.aborted) return;

  if (!root || typeof root !== "string") {
    return json(res, 400, { error: "root is required" });
  }
  const names = normalizePatterns(patterns);
  if (names.length === 0) {
    return json(res, 400, { error: "at least one pattern is required" });
  }

  try {
    await fsp.access(root);
  } catch {
    return json(res, 400, { error: `cannot read root: ${root}` });
  }
  if (signal.aborted) return;

  // NDJSON so the UI can show progress during a long scan rather than
  // staring at a spinner.
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
  });

  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const matches = (name) => wanted.has(name.toLowerCase());

  const started = Date.now();
  offered.clear("zap");

  let result;
  try {
    result = await scanVolume({
      root,
      matches,
      // The same test, counted live while the MFT streams.
      countMatch: matches,
      signal,
      onProgress: (note) => res.write(JSON.stringify({ type: "progress", ...note }) + "\n"),
    });
  } catch (err) {
    // The client stopped the run and is no longer listening.
    if (signal.aborted) return;
    throw err;
  }

  offered.add(result.hits.map((hit) => hit.path), "zap");

  res.write(
    JSON.stringify({
      type: "done",
      strategy: result.strategy,
      reason: result.reason ?? null,
      elapsedMs: Date.now() - started,
      stats: result.stats,
      hits: result.hits,
    }) + "\n",
  );
  res.end();
}

async function grepRoute(req, res) {
  // Stop ripgrep if the user presses Stop, navigates away or starts a new
  // search; otherwise a broad pattern keeps a process busy for nothing.
  const signal = abortOnDisconnect(res);

  const body_ = await body(req);
  if (signal.aborted) return;
  const { root, pattern } = body_;

  if (!pattern || typeof pattern !== "string") {
    return json(res, 400, { error: "pattern is required" });
  }
  if (!root || typeof root !== "string") {
    return json(res, 400, { error: "root is required" });
  }

  try {
    await fsp.access(root);
  } catch {
    return json(res, 400, { error: `cannot read root: ${root}` });
  }
  if (signal.aborted) return;

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
  });

  const started = Date.now();

  try {
    const result = await runRipgrep(
      {
        pattern,
        root,
        caseMode: body_.caseMode,
        regex: body_.regex !== false,
        word: body_.word === true,
        hidden: body_.hidden === true,
        globs: parseGlobs(body_.globs),
      },
      {
        onGroup: (group) =>
          res.write(JSON.stringify({ type: "file", ...group }) + "\n"),
        signal,
      },
    );

    if (signal.aborted) return;
    res.write(
      JSON.stringify({
        type: "done",
        files: result.files,
        truncated: result.truncated,
        elapsedMs: Date.now() - started,
      }) + "\n",
    );
  } catch (err) {
    res.write(JSON.stringify({ type: "done", error: err.message, files: 0 }) + "\n");
  }

  res.end();
}

async function planRoute(req, res) {
  const { paths, bytes } = await body(req);

  if (!Array.isArray(paths) || paths.length === 0) {
    return json(res, 400, { error: "paths must be a non-empty array" });
  }

  const { allowed, refused } = buildPlan(paths, { offered, screen: screenPaths });

  // Confirm each path still exists, and nothing more. Totalling the bytes
  // again would re-walk every subtree — for a few hundred node_modules that
  // is a minute of stat calls, during which the button looks dead. The byte
  // figure is a display value the scan already computed; existence is what
  // the plan actually has to be right about.
  const present = [];
  const missing = [];

  await Promise.all(
    allowed.map(async (target) => {
      try {
        const stat = await fsp.stat(target);
        (stat.isDirectory() ? present : missing).push(target);
      } catch {
        missing.push(target);
      }
    }),
  );

  const token = randomUUID();
  plans.set(token, { paths: present, expires: Date.now() + PLAN_TTL_MS });
  sweepPlans();

  json(res, 200, {
    token,
    count: present.length,
    bytes: typeof bytes === "string" ? bytes : "0",
    paths: present,
    refused,
    missing,
  });
}

async function zapRoute(req, res) {
  const { token, permanent, confirmCount } = await body(req);

  const plan = plans.get(token);
  if (!plan || plan.expires < Date.now()) {
    plans.delete(token);
    return json(res, 400, { error: "plan expired — scan and re-select" });
  }

  // The typed count must match the plan. A stale tab cannot delete a
  // different set than the one the user read.
  if (confirmCount !== plan.paths.length) {
    return json(res, 400, {
      error: `confirmation mismatch: plan has ${plan.paths.length} paths, got ${confirmCount}`,
    });
  }

  plans.delete(token);

  // Streamed, like the scan: deleting hundreds of folders takes long enough
  // that the UI needs to show movement rather than hang on one request.
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
  });

  const started = Date.now();
  const results = await zapPaths(plan.paths, {
    permanent: permanent === true,
    onProgress: (note) =>
      res.write(JSON.stringify({ type: "progress", ...note }) + "\n"),
  });

  const deleted = results.filter((r) => r.ok).map((r) => r.path);
  // Before the done line: a map that reloads on it must see the change.
  maps.removePaths(deleted);

  res.write(
    JSON.stringify({
      type: "done",
      permanent: permanent === true,
      elapsedMs: Date.now() - started,
      deleted,
      failed: results.filter((r) => !r.ok),
    }) + "\n",
  );
  res.end();
}

/**
 * Read a whole drive into a space-map snapshot. Streams the MFT progress
 * notes, then "junk" and "compact", then one done line naming the snapshot.
 */
async function mapReadRoute(req, res) {
  const signal = abortOnDisconnect(res);

  const { root, patterns, disabled } = await body(req);
  if (signal.aborted) return;

  const drive = typeof root === "string" ? driveOf(root.trim()) : null;
  if (!drive) return json(res, 400, { error: "root must be a path on a drive" });

  // The junk marks use the same rules as the other tabs: the enabled cache
  // entries and the Zap tab's folder names.
  const { entries: all } = await loadPacks();
  const off = new Set(Array.isArray(disabled) ? disabled : []);
  const entries = all.filter((e) => !off.has(e.id));
  const { drives } = await listRoots();
  if (signal.aborted) return;

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
  });
  const write = (note) => res.write(JSON.stringify(note) + "\n");

  try {
    const result = await readMap({
      drive,
      root: root.trim(),
      store: maps,
      entries,
      patterns: normalizePatterns(patterns),
      drives,
      signal,
      onProgress: (note) => write({ type: "progress", ...note }),
    });
    write({ type: "done", ...result });
  } catch (err) {
    // The client stopped the run and is no longer listening.
    if (signal.aborted) return;
    // A newer read of the same drive replaced this one.
    write({ type: "done", failure: err.name === "AbortError" ? "replaced by a newer read" : err.message });
  }
  res.end();
}

/** One page of a held snapshot. A stale generation is a 409. */
function mapNodeRoute(url, res) {
  const q = url.searchParams;
  const { slot, stale } = maps.at(q.get("drive") ?? "", q.get("gen"));
  // The client re-roots from here: same `read` means its ids still hold.
  if (stale) {
    return json(res, 409, { error: "the map changed", gen: stale.gen, read: stale.read });
  }
  if (!slot) return json(res, 404, { error: "no map for that drive" });

  const page = childrenPage(slot.snap, Number(q.get("id") ?? 0), {
    depth: Number(q.get("depth") ?? 2),
    limit: Number(q.get("limit") ?? 40),
  });
  if (!page) return json(res, 404, { error: "no such folder" });
  json(res, 200, { gen: slot.gen, ...page });
}

/**
 * Folders picked on the map, as paths. What passes is offered under
 * "map", so /plan accepts it — with the depth rule still in force.
 */
async function mapOfferRoute(req, res) {
  const { drive, gen, recNos } = await body(req);

  if (!Array.isArray(recNos) || recNos.length === 0) {
    return json(res, 400, { error: "recNos must be a non-empty array" });
  }
  const { slot, stale } = maps.at(typeof drive === "string" ? drive : "", gen);
  if (stale) {
    return json(res, 409, { error: "the map changed", gen: stale.gen, read: stale.read });
  }
  if (!slot) return json(res, 404, { error: "no map for that drive" });

  const result = await offerPicks(slot.snap, recNos, { identify: identifyFolder });
  // A new pick replaces the last one's offer.
  offered.clear("map");
  offered.add(result.paths, "map");
  json(res, 200, result);
}

// ---------------------------------------------------------------------------

async function listRoots() {
  const roots = [];
  for (let code = 65; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      await fsp.access(drive);
      roots.push(drive);
    } catch {
      /* not present */
    }
  }
  return { drives: roots, home: os.homedir() };
}

function normalizePatterns(patterns) {
  if (typeof patterns === "string") patterns = patterns.split(",");
  if (!Array.isArray(patterns)) return [];
  return patterns.map((p) => String(p).trim()).filter(Boolean);
}

function sweepPlans() {
  const now = Date.now();
  for (const [token, plan] of plans) {
    if (plan.expires < now) plans.delete(token);
  }
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`bad JSON body: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

/**
 * A signal that aborts when the client goes away before the response is
 * finished — the Stop button, a closed tab, a new run. 'close' also fires
 * after a normal end, which must not count as a stop.
 */
function abortOnDisconnect(res) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
