/**
 * The Caches tab's demo data: the rules that match on the demo drive, the
 * two batches the scan reports, and the one action it lists.
 *
 * A hit whose path is a folder of the demo drive (map.js) takes that
 * folder's live size, so a delete in any tab shows here too.
 */

const RULES = {
  "npm-cache": { label: "npm cache", tool: "npm", pack: "javascript", cost: "Re-downloaded on the next install." },
  "pnpm-store": { label: "pnpm store", tool: "pnpm", pack: "javascript", cost: "Packages re-downloaded on the next install." },
  "yarn-cache": { label: "Yarn cache", tool: "yarn", pack: "javascript", cost: "Re-downloaded on the next install." },
  "playwright-browsers": { label: "Playwright browsers", tool: "playwright", pack: "javascript", cost: "Re-downloaded by playwright install." },
  "next-build": { label: "Next.js build cache", tool: "next", pack: "javascript", cost: "Rebuilt on the next build.", perProject: true },
  "pip-cache": { label: "pip cache", tool: "pip", pack: "python", cost: "Re-downloaded on the next install." },
  "uv-cache": { label: "uv cache", tool: "uv", pack: "python", cost: "Re-downloaded on the next sync." },
  "python-bytecode": { label: "Python bytecode", tool: "python", pack: "python", cost: "Regenerated on the next import.", perProject: true },
  "cargo-registry": {
    label: "Cargo registry",
    tool: "cargo",
    pack: "rust",
    cost: "Crates re-downloaded on the next build.",
    riskNote: "Holds crate sources too. A cold rebuild after is slow.",
  },
  "cargo-git": { label: "Cargo git checkouts", tool: "cargo", pack: "rust", cost: "Re-cloned on the next build." },
  "jetbrains-caches": { label: "JetBrains caches", tool: "jetbrains", pack: "tools", cost: "Rebuilt when the IDE re-indexes." },
};

const HOME = "C:\\Users\\dev";
const LOCAL = `${HOME}\\AppData\\Local`;
const CODE = `${HOME}\\code`;

/** [rule id, path, MB, files, project age in days (per-project rules)] */
export const FOUND_BATCHES = [
  [
    ["npm-cache", `${LOCAL}\\npm-cache`, 3400, 61000],
    ["pnpm-store", `${LOCAL}\\pnpm\\store`, 5200, 240000],
    ["pip-cache", `${LOCAL}\\pip\\cache`, 1200, 8800],
    ["cargo-registry", `${HOME}\\.cargo\\registry`, 2100, 52000],
    ["jetbrains-caches", `${LOCAL}\\JetBrains`, 2900, 30000],
  ],
  [
    ["next-build", `${CODE}\\storefront\\.next`, 620, 4100, 2],
    ["next-build", `${CODE}\\atlas\\packages\\web\\.next`, 180, 1300, 12],
    ["python-bytecode", `${CODE}\\sensor-hub\\src\\sensor\\__pycache__`, 2.1, 48, 210],
    ["python-bytecode", `${CODE}\\sensor-hub\\src\\sensor\\drivers\\__pycache__`, 0.8, 22, 210],
    ["python-bytecode", `${CODE}\\sensor-hub\\tests\\__pycache__`, 0.6, 15, 210],
    ["python-bytecode", `${CODE}\\harbor-cli\\scripts\\__pycache__`, 0.3, 6, 400],
  ],
];

export const ACTIONS = [
  {
    id: "docker-dangling-images",
    action: "docker-image-prune",
    label: "Docker dangling images",
    tool: "docker",
    pack: "tools",
    cost: "Removes untagged images that no container uses.",
    risk: "safe",
    riskNote: null,
    available: true,
    reason: null,
    bytes: null,
    commands: ["docker image prune -f"],
  },
];

/** What the action prints while it runs. */
export const ACTION_LINES = [
  "Deleted Images:",
  "deleted: sha256:4f1c9e0a7b2d",
  "deleted: sha256:9a03be51c7e4",
  "Total reclaimed space: 1.24GB",
];

export const PACKS = ["javascript", "python", "rust", "tools"].map((name) => ({
  name,
  description: `${name} caches`,
  file: `${name}.json`,
  count:
    Object.values(RULES).filter((r) => r.pack === name).length +
    ACTIONS.filter((a) => a.pack === name).length,
}));

const DAY_MS = 86_400_000;
const MB = 1024 * 1024;

/**
 * One batch as the server's "found" note carries it.
 *
 * @param {Array} rows one of FOUND_BATCHES
 * @param {{now: number, sizeOf: (path: string) => {bytes: number, files: number}|null,
 *          gone: (path: string) => boolean, disabled: Set<string>}} ctx
 *   sizeOf reads the demo drive; gone says a delete took the path
 */
export function foundOf(rows, { now, sizeOf, gone, disabled }) {
  return rows
    .filter(([id, path]) => !disabled.has(id) && !gone(path))
    .map(([id, path, mb, files, age]) => {
      const rule = RULES[id];
      const live = sizeOf(path);
      return {
        id,
        label: rule.label,
        tool: rule.tool,
        pack: rule.pack,
        cost: rule.cost,
        risk: rule.riskNote ? "caution" : "safe",
        riskNote: rule.riskNote ?? null,
        path,
        bytes: String(live ? live.bytes : Math.round(mb * MB)),
        files: live ? live.files : files,
        perProject: rule.perProject === true,
        project: age === undefined ? null : { path: projectOf(path), lastTouched: now - age * DAY_MS },
        mode: "delete",
      };
    });
}

/** C:\Users\dev\code\atlas\packages\web\.next -> C:\Users\dev\code\atlas\packages\web */
function projectOf(path) {
  const cut = path.search(/\\(?:\.next|src|tests|scripts)\\?/);
  return cut > 0 ? path.slice(0, cut) : path;
}
