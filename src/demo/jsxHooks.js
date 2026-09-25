/**
 * Test-only: lets node import the app's .jsx files. Compiles each one with
 * the oxc transform that ships with rolldown (Vite's bundler), using the
 * automatic React runtime, as the Vite build does.
 *
 *   import "./jsxHooks.js";  // before importing any .jsx
 */

import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { transformSync } from "rolldown/experimental";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".jsx")) return nextLoad(url, context);
    const { source } = nextLoad(url, { ...context, format: "module" });
    const path = fileURLToPath(url);
    const out = transformSync(path, String(source), { jsx: { runtime: "automatic" } });
    if (out.errors.length) throw new Error(`${path}: ${out.errors.map((e) => e.message).join("; ")}`);
    return { format: "module", source: out.code, shortCircuit: true };
  },
});
