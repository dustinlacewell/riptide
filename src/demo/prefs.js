import { KEY } from "../persist.js";
import { createMemoryStore } from "../storage.js";

/**
 * The demo's preference store: in memory, so a visitor's clicks never
 * write to their browser, and seeded so the first Scan and Search find
 * something to show.
 */
export const DEMO_PREFS = {
  patterns: "node_modules, dist, target",
  pattern: "TODO|FIXME",
};

export function createDemoStore() {
  return createMemoryStore({ [KEY]: JSON.stringify(DEMO_PREFS) });
}
