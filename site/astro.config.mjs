import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

// The site imports the app's design tokens from ../src/ui/tokens.css, so the
// dev server must be allowed to read the repo root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  site: "https://riptide.ldlework.com",
  output: "static",
  vite: {
    server: { fs: { allow: [repoRoot] } },
  },
});
