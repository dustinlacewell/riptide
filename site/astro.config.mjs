import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// The site imports the app itself (../src) for the hero demo, and the app's
// design tokens, so the dev server must be allowed to read the repo root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  site: "https://riptide.ldlework.com",
  output: "static",
  integrations: [react()],
  vite: {
    server: { fs: { allow: [repoRoot] } },
    // ../src resolves react from the repo root's node_modules; one copy only.
    resolve: { dedupe: ["react", "react-dom"] },
  },
});
