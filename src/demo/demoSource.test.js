/**
 * Contract tests for the demo source: each stream goes through the same
 * pure consumers the app uses, so a demo that drifts from the real shapes
 * fails here rather than on the site.
 *
 *   node --test src/demo/demoSource.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { applyDeleteNote, finishRun, sizesByPath, startRun } from "../deleteTally.js";
import { groupHits } from "../group.js";
import { dropRecords, reclaimItems, togglePick } from "../mapPicks.js";
import { drillable, layoutPage, selectable } from "../mapView.js";
import { refusedPaths, riskOf } from "../risk.js";
import { IDLE, scanReducer } from "../scanStream.js";
import { createDemoSource } from "./demoSource.js";
import { TREE } from "./map.js";
import { buildPages, indexTree, measure } from "./mapModel.js";
import { instantSleep } from "./player.js";

const NOW = Date.UTC(2026, 8, 25);
const DAY = 86_400_000;
const GB = 1024 ** 3;
const HOME = "C:\\Users\\dev";
const CODE = `${HOME}\\code`;
const PATTERNS = "node_modules, dist, target";

const demo = () => createDemoSource({ clock: () => NOW, sleep: instantSleep });

/** Fold a stream's notes through the telemetry reducer, as useScanStream does. */
async function telemetryOf(start) {
  let t = 0;
  let state = scanReducer(IDLE, { type: "start", t });
  const done = await start((note) => {
    state = scanReducer(state, { type: "note", note, t: (t += 120) });
  });
  return { done, state, finish: (extra) => scanReducer(state, { type: "finish", t: t + 1, ...extra }) };
}

const scan = (src) =>
  telemetryOf((onProgress) => src.scan({ root: HOME, patterns: PATTERNS, onProgress }));

// --- scan -----------------------------------------------------------------

test("scan: the telemetry reducer walks read, index, size and reaches done", async () => {
  const { done, state, finish } = await scan(demo());
  assert.equal(state.phase, "size");
  assert.equal(state.recordsDone, 4_870_000);
  assert.ok(state.rate > 0);
  const end = finish({ strategy: done.strategy, stats: done.stats, elapsedMs: done.elapsedMs });
  assert.equal(end.phase, "done");
  assert.equal(end.receipt.records, 4_870_000);
  assert.equal(end.receipt.how, "full");
});

test("scan: about forty hits, ~18.6 GB, sized and dated like the server's", async () => {
  const { done } = await scan(demo());
  const hits = done.hits;
  assert.ok(hits.length >= 38 && hits.length <= 42, `${hits.length} hits`);

  const outside = hits.filter((h) => !h.path.startsWith(CODE));
  assert.deepEqual(outside.map((h) => h.path), ["C:\\Windows\\SystemApps\\WebExperience\\node_modules"]);

  const total = hits.filter((h) => h.path.startsWith(CODE)).reduce((s, h) => s + Number(h.bytes), 0);
  assert.ok(Math.abs(total / GB - 18.6) < 0.2, `${(total / GB).toFixed(2)} GB`);

  for (const h of hits) {
    assert.equal(typeof h.bytes, "string");
    assert.ok(Number(h.bytes) >= 40 * 1024 ** 2 && Number(h.bytes) <= 2.1 * GB, h.path);
    assert.ok(Number.isInteger(h.files));
  }
  const ages = hits.map((h) => (NOW - h.mtime) / DAY);
  assert.equal(Math.min(...ages), 2);
  assert.ok(Math.max(...ages) >= 3 * 365 - 1);
});

test("scan: only the typed folder names match", async () => {
  const { done } = await telemetryOf((onProgress) =>
    demo().scan({ root: HOME, patterns: "target", onProgress }),
  );
  assert.ok(done.hits.length > 0);
  assert.ok(done.hits.every((h) => h.path.endsWith("\\target")));
});

// --- plan and zap -----------------------------------------------------------

test("plan: echoes the selection, refuses the system path, and counts", async () => {
  const src = demo();
  const { done } = await scan(src);
  const plan = await src.plan(done.hits.map((h) => h.path), "123", []);

  assert.equal(plan.refused.length, 1);
  assert.match(plan.refused[0].path, /^C:\\Windows\\/);
  assert.equal(plan.refused[0].reason, "inside a protected system folder");
  assert.equal(plan.count, done.hits.length - 1);
  assert.equal(plan.paths.length, plan.count);
  assert.equal(plan.bytes, "123");

  const refused = refusedPaths(plan.refused);
  const windows = done.hits.find((h) => h.path.startsWith("C:\\Windows"));
  assert.equal(riskOf(windows, refused), "refused");
});

test("zap: the tally frees each deleted path's bytes; one path is in use", async () => {
  const src = demo();
  const { done } = await scan(src);
  const items = done.hits.filter((h) => !h.path.startsWith("C:\\Windows"));
  const plan = await src.plan(items.map((h) => h.path), "0");

  let run = startRun({ paths: plan.paths, sizes: sizesByPath(items), permanent: false, t: 0 });
  const res = await src.zap({
    token: plan.token,
    permanent: false,
    confirmCount: plan.count,
    onProgress: (note) => (run = applyDeleteNote(run, note)),
  });
  run = finishRun(run, { t: 1, elapsedMs: res.elapsedMs });

  assert.equal(run.failed.size, 1);
  assert.match([...run.failed.values()][0], /in use/);
  assert.equal(run.deleted, plan.count - 1);
  const expected = items
    .filter((h) => res.deleted.includes(h.path))
    .reduce((s, h) => s + BigInt(h.bytes), 0n);
  assert.equal(run.freed, expected.toString());
  assert.equal(run.receipt.deleted, run.deleted);

  // The disk changed: a rescan finds only what is left.
  const again = await scan(src);
  assert.deepEqual(
    again.done.hits.map((h) => h.path).sort(),
    [...res.failed.map((f) => f.path), windowsHit(done.hits)].sort(),
  );
});

test("zap: a wrong count or a used token is refused", async () => {
  const src = demo();
  const plan = await src.plan([`${CODE}\\ledger-ui\\dist`], "0");
  await assert.rejects(src.zap({ token: plan.token, confirmCount: 99 }), /mismatch/);
  await src.zap({ token: plan.token, confirmCount: 1 });
  await assert.rejects(src.zap({ token: plan.token, confirmCount: 1 }), /expired/);
});

// --- caches -----------------------------------------------------------------

async function cachesOf(src, disabled = []) {
  const found = [];
  let actions = null;
  const run = await telemetryOf((onProgress) =>
    src.caches({ disabled, root: HOME }, (note) => {
      if (note.type === "found") found.push(note.found);
      else if (note.type === "actions") actions = note.actions;
      else onProgress(note);
    }),
  );
  return { ...run, found, actions };
}

test("caches: two found batches group into twelve-ish rules over four packs", async () => {
  const { found, actions, state } = await cachesOf(demo());
  assert.equal(found.length, 2);
  assert.equal(state.phase, "size");

  const groups = groupHits(found.flat());
  assert.equal(groups.length + actions.length, 12);
  assert.equal(new Set(found.flat().map((h) => h.pack)).size, 4);

  const caution = groups.filter((g) => riskOf(g) === "caution");
  assert.equal(caution.length, 1);
  assert.ok(caution[0].riskNote.length > 20);

  const perProject = groups.filter((g) => g.perProject);
  assert.equal(perProject.length, 2);
  for (const g of perProject) {
    assert.ok(g.count > 1);
    for (const hit of g.paths) assert.ok(hit.project.lastTouched < NOW);
  }

  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].commands, ["docker image prune -f"]);
});

test("caches: a disabled rule is not reported", async () => {
  const { found } = await cachesOf(demo(), ["python-bytecode", "npm-cache"]);
  const ids = new Set(found.flat().map((h) => h.id));
  assert.equal(ids.has("python-bytecode"), false);
  assert.equal(ids.has("npm-cache"), false);
});

// --- map --------------------------------------------------------------------

async function readMap(src) {
  const { done, finish } = await telemetryOf((onProgress) =>
    src.mapRead({ root: HOME, patterns: PATTERNS }, onProgress),
  );
  assert.equal(finish({ stats: done.stats }).phase, "done");
  return done;
}

test("map: pages have the server's childrenPage shape and lay out", async () => {
  const src = demo();
  const map = await readMap(src);
  const page = await src.mapNode({ drive: map.drive, gen: map.gen, id: map.rootId });

  assert.equal(page.node.name, "dev");
  assert.deepEqual(page.trail.map((c) => c.name), ["C:\\", "Users", "dev"]);
  for (const key of ["children", "other", "ownFiles"]) assert.ok(key in page);
  const row = page.children[0];
  for (const key of ["id", "recNo", "name", "bytes", "files", "junk", "junkBytes", "cautionBytes", "hasKids"]) {
    assert.ok(key in row, key);
  }
  assert.ok(row.kids.children.length > 0, "depth 2 nests each child's listing");

  const tiles = layoutPage(page, { x: 0, y: 0, w: 900, h: 520 });
  assert.ok(tiles.length > page.children.length, "children and their kids become tiles");
  assert.ok(tiles.some((t) => t.nested));
});

test("map: drillable three levels under code", async () => {
  const src = demo();
  const map = await readMap(src);
  const show = (id) => src.mapNode({ drive: "C:", gen: map.gen, id });

  const dev = await show(map.rootId);
  const code = await show(dev.children.find((c) => c.name === "code").id);
  const project = code.children.find((c) => c.name === "storefront");
  assert.ok(drillable({ kind: "folder", ...project }));
  const storefront = await show(project.id);
  const modules = storefront.children.find((c) => c.name === "node_modules");
  assert.equal(modules.junk, "name-hit");
  const packages = await show(modules.id);
  assert.ok(packages.children.length >= 5);
  assert.deepEqual(packages.trail.slice(-3).map((c) => c.name), ["code", "storefront", "node_modules"]);
});

test("map: about sixty-plus pages, one per live folder", () => {
  const index = indexTree(TREE);
  const pages = buildPages(index, measure(index));
  assert.ok(pages.size >= 60, `${pages.size} pages`);
  assert.equal(pages.size, index.nodes.length);
});

test("map: picks, offer, delete, then one 409 and a smaller folder", async () => {
  const src = demo();
  const map = await readMap(src);
  const code = (await src.mapNode({ drive: "C:", gen: map.gen, id: map.rootId })).children.find(
    (c) => c.name === "code",
  );
  const page = await src.mapNode({ drive: "C:", gen: map.gen, id: code.id });
  const target = page.children.find((c) => c.name === "tide-api").kids.children.find((c) => c.name === "target");
  assert.ok(selectable({ kind: "folder", ...target }));

  let picks = togglePick(new Map(), target);
  assert.deepEqual(reclaimItems(picks), [{ bytes: String(target.bytes), risk: "safe" }]);

  const windows = (await src.mapNode({ drive: "C:", gen: map.gen, id: 0 })).children.find(
    (c) => c.name === "Windows",
  );
  assert.equal(windows.locked, "inside a protected system folder");

  const offer = await src.mapOffer({ drive: "C:", gen: map.gen, recNos: [target.recNo, windows.recNo] });
  assert.equal(offer.items.length, 1);
  assert.equal(offer.refused.length, 1);

  const plan = await src.plan(offer.paths, offer.bytes);
  const res = await src.zap({ token: plan.token, confirmCount: plan.count });
  picks = dropRecords(picks, [target.recNo]);
  assert.equal(picks.size, 0);
  assert.deepEqual(res.deleted, offer.paths);

  let stale = null;
  await assert.rejects(src.mapNode({ drive: "C:", gen: map.gen, id: code.id }), (err) => {
    stale = err.stale;
    return true;
  });
  assert.equal(stale.read, map.read, "the same read: the client keeps its folder");
  assert.ok(stale.gen > map.gen);
  const fresh = await src.mapNode({ drive: "C:", gen: stale.gen, id: code.id });
  assert.equal(fresh.node.bytes, page.node.bytes - target.bytes);
});

// --- grep -------------------------------------------------------------------

test("grep: eight files, two to five lines each, spans on the match", async () => {
  const files = [];
  const done = await demo().grep({ root: CODE, pattern: "TODO|FIXME" }, (f) => files.push(f));
  assert.equal(files.length, 8);
  assert.equal(done.files, 8);
  for (const file of files) {
    assert.ok(file.lines.length >= 2 && file.lines.length <= 5, file.path);
    for (const { text, spans } of file.lines) {
      for (const [a, b] of spans) assert.match(text.slice(a, b), /^(TODO|FIXME)$/);
    }
  }
});

test("grep: a bad regex ends with an error, not a throw", async () => {
  const done = await demo().grep({ root: CODE, pattern: "(" }, () => {});
  assert.ok(done.error);
});

function windowsHit(hits) {
  return hits.find((h) => h.path.startsWith("C:\\Windows")).path;
}
