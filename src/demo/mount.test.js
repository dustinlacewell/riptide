/**
 * The site's hero mounts the real app on the demo source. This renders it
 * to a string the way the site wires it, so an app that throws on the demo
 * fails here rather than blank on the page. It also calls the source
 * methods App's mount effects call, which a string render does not run.
 *
 *   node --test src/demo/mount.test.js
 */

import "./jsxHooks.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { SourceProvider } from "../source/context.js";
import { createDemoSource } from "./demoSource.js";
import { instantSleep } from "./player.js";
import { createDemoStore } from "./prefs.js";

const { default: App } = await import("../App.jsx");

const NOW = Date.UTC(2026, 8, 25);
const demo = () => createDemoSource({ clock: () => NOW, sleep: instantSleep });

test("mount: the app renders on the demo source with its tabs and demo badge", () => {
  const html = renderToString(
    createElement(
      SourceProvider,
      { source: demo(), storage: createDemoStore(), clock: () => 0 },
      createElement(App),
    ),
  );
  for (const tab of ["Zap", "Caches", "Map", "Search"]) assert.ok(html.includes(`>${tab}`), tab);
  assert.ok(html.includes("Demo — nothing touches your disk"));
});

test("mount: the calls App makes on mount answer in the shapes it reads", async () => {
  const src = demo();
  const roots = await src.getRoots();
  assert.equal(typeof roots.home, "string");
  assert.ok(roots.home.length > 0);
  assert.ok(Array.isArray(roots.drives));
  const settings = await src.putSettings({ keepDrives: 2 });
  assert.equal(settings.keepDrives, 2);
});
