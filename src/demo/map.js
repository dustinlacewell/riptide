/**
 * The demo's drive: one nested literal that every demo tab reads. The Map
 * tab pages it, the Zap tab's hits are the folders in it with a picked name,
 * and a delete from any tab takes folders out of it.
 *
 *   dir(name, kids, opts)        a folder with subfolders
 *   leaf(name, mb, files, opts)  a folder with files only
 *   opts: own [mb, files] files directly in a dir; age in days, which a
 *         folder's hits inherit; junk "cache-safe" | "cache-caution" and
 *         label, for a folder a cache rule knows
 *
 * Names are made up. Sizes are MB.
 */

const MB = 1024 * 1024;

function dir(name, kids, { own = [0, 0], ...opts } = {}) {
  return { name, bytes: own[0] * MB, files: own[1], kids, ...opts };
}

function leaf(name, mb, files, opts = {}) {
  return { name, bytes: Math.round(mb * MB), files, kids: [], ...opts };
}

/** A node_modules split over its biggest packages. */
function modules(mb, files, packages, opts = {}) {
  const weights = packages.map((_, i) => 1 / (i + 1.4));
  const sum = weights.reduce((a, b) => a + b, 0);
  const kids = packages.map((name, i) =>
    leaf(name, (mb * weights[i]) / sum, Math.round((files * weights[i]) / sum)),
  );
  return dir("node_modules", kids, opts);
}

const git = (mb) => leaf(".git", mb, Math.round(mb * 9));
const src = (mb) => leaf("src", mb, Math.round(mb * 40));

const WEB = ["next", "@swc", "typescript", "@next", "esbuild", "react-dom", "caniuse-lite", "lodash"];
const VITE = ["@esbuild", "typescript", "rollup", "vite", "@babel", "react-dom", "prettier"];
const ELECTRON = ["electron", "app-builder-bin", "typescript", "@electron", "7zip-bin", "esbuild"];

const PROJECTS = [
  dir("storefront", [
    modules(1980, 88000, WEB),
    leaf(".next", 620, 4100, { junk: "cache-safe", label: "Next.js build cache" }),
    src(38), git(210), leaf("public", 64, 310),
  ], { age: 2 }),
  dir("atlas", [
    modules(1650, 71000, ["@esbuild", "typescript", "turbo", "@types", "vitest", "prettier"]),
    dir("packages", [
      dir("web", [modules(420, 16000, VITE), leaf("dist", 40, 120),
        leaf(".next", 180, 1300, { junk: "cache-safe", label: "Next.js build cache" }), src(12)]),
      dir("api", [modules(380, 14000, ["prisma", "@prisma", "typescript", "zod"]), leaf("dist", 44, 90), src(9)]),
      dir("shared", [modules(190, 7000, ["typescript", "zod", "date-fns"]), leaf("dist", 41, 60), src(4)]),
      dir("cli", [modules(240, 9000, ["esbuild", "commander", "chalk"]), leaf("dist", 52, 40), src(3)]),
    ]),
    git(330),
  ], { age: 12 }),
  dir("tide-api", [
    dir("target", [leaf("debug", 1620, 9100), leaf("release", 530, 2200)]),
    src(6), git(140),
  ], { age: 3 }),
  dir("ledger-ui", [modules(612, 31000, VITE), leaf("dist", 48, 60), src(22), git(95)], { age: 5 }),
  dir("api-gateway", [modules(530, 24000, ["typescript", "@aws-sdk", "esbuild", "pino"]), leaf("dist", 60, 80), src(14), git(70)], { age: 8 }),
  dir("weather-bot", [modules(205, 9000, ["discord.js", "typescript", "undici"]), leaf("dist", 40, 30), src(3)], { age: 25 }),
  dir("docs-site", [modules(700, 34000, ["astro", "@astrojs", "shiki", "typescript", "sharp"]), leaf("dist", 112, 900), src(18), git(60)], { age: 40 }),
  dir("orbit-engine", [leaf("target", 2010, 11800), src(11), git(120)], { age: 60 }),
  dir("design-tokens", [modules(140, 6000, ["style-dictionary", "typescript"]), leaf("dist", 41, 200)], { age: 70 }),
  dir("mobile-app", [modules(2080, 97000, ["react-native", "@expo", "hermes-engine", "@babel", "metro"]), src(30), git(180)], { age: 95 }),
  dir("quill", [modules(1380, 52000, ELECTRON), leaf("dist", 260, 150), src(26), git(150)], { age: 150 }),
  dir("wasm-demo", [leaf("target", 540, 3100), modules(160, 6000, ["wasm-pack", "vite"]), leaf("dist", 40, 20)], { age: 180 }),
  dir("sensor-hub", [leaf(".venv", 880, 19000), leaf("data", 2200, 140), src(8), git(45)], { age: 210 }),
  dir("forms-poc", [modules(290, 12000, ["react-scripts", "@babel", "webpack"])], { age: 300 }),
  dir("harbor-cli", [leaf("dist", 40, 12), src(5), git(30)], { age: 400 }),
  dir("game-jam-2024", [modules(260, 11000, ["phaser", "vite"]), leaf("dist", 48, 90)], { age: 500 }),
  dir("rust-sandbox", [leaf("target", 980, 6400), src(1)], { age: 520 }),
  dir("pixel-lab", [modules(450, 21000, VITE), leaf("dist", 55, 70)], { age: 730 }),
  dir("old-portfolio", [modules(310, 15000, ["gatsby", "sharp", "@babel"]), leaf("dist", 44, 300)], { age: 1095 }),
  dir("chartkit", [modules(380, 17000, ["d3", "typescript", "rollup"]), leaf("dist", 42, 60)], { age: 1100 }),
];

const APPDATA = dir("AppData", [
  dir("Local", [
    leaf("npm-cache", 3400, 61000, { junk: "cache-safe", label: "npm cache" }),
    dir("pnpm", [leaf("store", 5200, 240000, { junk: "cache-safe", label: "pnpm store" })]),
    leaf("Docker", 18400, 40, { junk: "cache-caution", label: "Docker WSL disk" }),
    leaf("JetBrains", 2900, 30000, { junk: "cache-safe", label: "JetBrains caches" }),
    leaf("ms-playwright", 1100, 9000, { junk: "cache-safe", label: "Playwright browsers" }),
    dir("pip", [leaf("cache", 1200, 8800, { junk: "cache-safe", label: "pip cache" })]),
    leaf("Microsoft", 4800, 26000),
    leaf("Temp", 2600, 14000),
  ]),
  dir("Roaming", [leaf("Code", 900, 7000), leaf("Slack", 1100, 3000), leaf("discord", 700, 2400)]),
]);

export const TREE = dir("C:\\", [
  dir("Windows", [
    leaf("WinSxS", 11200, 76000),
    leaf("System32", 6800, 21000),
    leaf("Installer", 4100, 900),
    dir("SystemApps", [dir("WebExperience", [leaf("node_modules", 64, 3100, { age: 400 })])]),
  ]),
  dir("Program Files", [
    leaf("JetBrains", 5200, 31000),
    leaf("Microsoft Office", 3700, 9800),
    leaf("Docker", 3100, 4200),
    leaf("NVIDIA Corporation", 1900, 1200),
  ]),
  leaf("ProgramData", 4200, 12000),
  dir("Users", [
    dir("dev", [
      dir("code", PROJECTS, { own: [0.2, 3] }),
      APPDATA,
      dir(".cargo", [
        leaf("registry", 2100, 52000, { junk: "cache-caution", label: "Cargo registry" }),
        leaf("git", 340, 4000, { junk: "cache-safe", label: "Cargo git checkouts" }),
      ]),
      leaf("Videos", 22800, 64),
      leaf("Downloads", 14200, 380),
      leaf("OneDrive", 8200, 9000),
      leaf("Documents", 3100, 2400),
    ], { own: [4, 12] }),
    leaf("Public", 120, 340),
  ]),
], { own: [22784, 3] });

/** A path the demo pretends a running dev server holds open. */
export const IN_USE_PATH = "C:\\Users\\dev\\code\\storefront\\node_modules";

/** What the drive reports as used beyond the files: metadata, the MFT, slack. */
export const UNACCOUNTED_BYTES = 9.3 * 1024 * MB;
