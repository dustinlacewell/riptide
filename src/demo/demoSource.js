/**
 * A data source with the httpSource.js interface that plays scripted
 * timelines over a made-up drive instead of calling the server. Nothing
 * here touches a disk.
 *
 * It keeps the state a visitor's clicks change: folders deleted (from any
 * tab), the map's gen and read, and open plans. A delete takes the folder
 * out of the drive, so a rescan, the Caches tab and the map all see it gone;
 * the map's next page request gets a 409, as a real map does after a delete.
 *
 * @param {{clock?: () => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>}} deps
 *   clock is wall-clock ms: it dates the hits' mtimes and projects' ages.
 *   sleep paces the timelines; a test passes instantSleep.
 */

import { pathKey } from "../pathKey.js";
import { ACTION_LINES, ACTIONS, FOUND_BATCHES, PACKS, foundOf } from "./caches.js";
import { grepFiles } from "./grep.js";
import { IN_USE_PATH, TREE, UNACCOUNTED_BYTES } from "./map.js";
import { buildPages, idOfPath, indexTree, lockOf, measure, offerPicks } from "./mapModel.js";
import { play, realSleep } from "./player.js";
import { cachesScript, grepScript, mapReadScript, RECORDS_TOTAL, scanScript, zapScript } from "./script.js";
import { namesOf, zapHits } from "./zapHits.js";

export const DEMO_HOME = "C:\\Users\\dev";
const IN_USE_ERROR = "in use by another process";
const PLAN_MS = 250;
const PAGE_MS = 40;
const FOLDERS = 1_214_000;

export const caps = {
  demo: true,
  directoryPicker: false,
  settings: false,
  leaveGuard: false,
  permanent: false,
  fullRescan: false,
  window: true,
};

export function createDemoSource({ clock = Date.now, sleep = realSleep } = {}) {
  const index = indexTree(TREE);
  const state = {
    removed: new Set(),
    gone: new Set(),
    names: new Set(),
    gen: 1,
    read: 0,
    plans: new Map(),
    tokens: 0,
    sized: null,
    pages: null,
  };
  remeasure();

  function remeasure() {
    state.sized = measure(index, { removed: state.removed, names: state.names });
    state.pages = null;
  }

  function pages() {
    state.pages ??= buildPages(index, state.sized);
    return state.pages;
  }

  function isGone(path) {
    if (state.gone.has(pathKey(path))) return true;
    return index.byPath.has(pathKey(path)) && idOfPath(index, state.sized, path) < 0;
  }

  function removePath(path) {
    state.gone.add(pathKey(path));
    const id = idOfPath(index, state.sized, path);
    if (id < 0) return;
    state.removed.add(id);
    state.gen += 1;
    remeasure();
  }

  function sizeOf(path) {
    const id = idOfPath(index, state.sized, path);
    return id < 0 ? null : { bytes: state.sized[id].bytes, files: state.sized[id].files };
  }

  function checkGen(gen) {
    if (state.read === 0) throw Object.assign(new Error("no map for C: — read the drive first"), { status: 404 });
    if (Number(gen) !== state.gen) {
      throw Object.assign(new Error("the map changed"), { stale: { gen: state.gen, read: state.read } });
    }
  }

  const run = (script, emit, signal) => play(script, emit, { sleep, signal });

  return {
    caps,

    getRoots: async () => ({ home: DEMO_HOME, drives: ["C:\\"] }),
    getDirs: async () => {
      throw new Error("Browsing is off in the demo");
    },
    cacheConfigs: async () => ({ packs: PACKS, errors: [], configs: [] }),
    getSettings: async () => ({ keepDrives: 2, bytesPerDrive: null }),
    putSettings: async ({ keepDrives }) => ({ keepDrives, bytesPerDrive: null }),

    scan({ root, patterns, onProgress, signal }) {
      const names = namesOf(patterns);
      if (!root) return Promise.reject(new Error("root is required"));
      if (names.size === 0) return Promise.reject(new Error("at least one pattern is required"));
      const hits = zapHits(index, state.sized, names, clock());
      return run(scanScript(hits, { now: clock }), onProgress, signal);
    },

    caches({ disabled }, onProgress, signal) {
      const off = new Set(disabled ?? []);
      const ctx = { now: clock(), sizeOf, gone: isGone, disabled: off };
      const batches = FOUND_BATCHES.map((rows) => foundOf(rows, ctx));
      const actions = ACTIONS.filter((a) => !off.has(a.id));
      return run(cachesScript({ actions, packs: PACKS, batches }, { now: clock }), onProgress, signal);
    },

    async grep(options, onFile, signal) {
      let files;
      try {
        files = grepFiles(options);
      } catch (err) {
        return { type: "done", error: err.message, files: 0 };
      }
      return run(grepScript(files, { now: clock }), onFile, signal);
    },

    async plan(paths, bytes, actions = []) {
      if (paths.length + actions.length === 0) {
        throw new Error("paths and actions must be arrays, not both empty");
      }
      await sleep(PLAN_MS);
      const refused = [];
      const missing = [];
      const present = [];
      for (const path of paths) {
        const reason = lockOf(path);
        if (reason) refused.push({ path, reason });
        else if (isGone(path)) missing.push(path);
        else present.push(path);
      }
      const bound = ACTIONS.filter((a) => actions.includes(a.action)).map((a) => ({
        id: a.action,
        label: a.label,
        risk: a.risk,
        commands: a.commands,
      }));
      const token = `demo-${++state.tokens}`;
      state.plans.set(token, { paths: present, actions: bound });
      return {
        token,
        count: present.length + bound.length,
        bytes: typeof bytes === "string" ? bytes : "0",
        paths: present,
        actions: bound,
        refused,
        refusedActions: [],
        missing,
      };
    },

    async zap({ token, permanent, confirmCount, onProgress }) {
      const plan = state.plans.get(token);
      if (!plan) throw new Error("plan expired — scan and re-select");
      const count = plan.paths.length + plan.actions.length;
      if (confirmCount !== count) {
        throw new Error(`confirmation mismatch: plan has ${count} items, got ${confirmCount}`);
      }
      state.plans.delete(token);
      const failOf = (path) => (pathKey(path) === pathKey(IN_USE_PATH) ? IN_USE_ERROR : null);
      const script = zapScript(
        { ...plan, permanent: permanent === true, failOf, lines: ACTION_LINES },
        { now: clock },
      );
      // Each folder leaves the drive as its result goes out, so a map
      // refresh mid-run already sees it gone.
      return run(script, (note) => {
        if (note.type === "progress" && note.ok) removePath(note.path);
        onProgress?.(note);
      });
    },

    mapRead({ root, patterns }, onProgress, signal) {
      const started = clock();
      const names = namesOf(patterns);
      return run(
        mapReadScript(() => {
          state.names = names;
          state.read += 1;
          state.gen += 1;
          remeasure();
          const top = state.sized[0];
          return {
            type: "done",
            drive: "C:",
            gen: state.gen,
            read: state.read,
            readAt: clock(),
            rootId: Math.max(0, idOfPath(index, state.sized, root ?? "")),
            stats: {
              records: RECORDS_TOTAL,
              readMs: 3000,
              how: "full",
              changes: 0,
              junkMs: 300,
              compactMs: 260,
              junkBytes: top.junkBytes,
              totalMs: clock() - started,
              folders: FOLDERS,
              rootBytes: top.bytes,
              volumeUsed: top.bytes + UNACCOUNTED_BYTES,
              unreachable: 0,
            },
          };
        }),
        onProgress,
        signal,
      );
    },

    async mapNode({ gen, id }, { signal } = {}) {
      await sleep(PAGE_MS, signal);
      checkGen(gen);
      const page = pages().get(Number(id));
      if (!page) throw Object.assign(new Error("no such folder"), { status: 404 });
      return page;
    },

    async mapOffer({ gen, recNos }) {
      await sleep(PAGE_MS);
      checkGen(gen);
      return offerPicks(index, state.sized, recNos);
    },
  };
}
