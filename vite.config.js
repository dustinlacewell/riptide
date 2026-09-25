import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import riptide from "./plugin/index.js";

export default defineConfig({
  plugins: [react(), riptide()],
});
