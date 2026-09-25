/**
 * The cache packs riptide ships, read from ../packs at build time, grouped
 * by their `pack` field. The site never states a count by hand.
 */

type Entry = { id: string; label: string; pack: string; action?: string };

const files = import.meta.glob<Entry>("../../../packs/*.json", {
  eager: true,
  import: "default",
});

const GROUP_NAMES: Record<string, string> = {
  javascript: "JavaScript",
  python: "Python",
  rust: "Rust",
  jvm: "JVM",
  docker: "Docker",
  editors: "Editors",
  apps: "Apps",
  ml: "Machine learning",
  gamedev: "Game engines",
  system: "Windows and drivers",
  misc: "Other languages and tools",
};

export type Group = { name: string; labels: string[] };

export const entries: Entry[] = Object.values(files);

/** Groups, largest first; labels sorted for reading. */
export function groupsOf(list: Entry[]): Group[] {
  const byPack = new Map<string, string[]>();
  for (const { pack, label } of list) {
    if (!byPack.has(pack)) byPack.set(pack, []);
    byPack.get(pack)!.push(label);
  }
  return [...byPack]
    .map(([pack, labels]) => ({
      name: GROUP_NAMES[pack] ?? pack,
      labels: labels.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
    }))
    .sort((a, b) => b.labels.length - a.labels.length || a.name.localeCompare(b.name));
}
