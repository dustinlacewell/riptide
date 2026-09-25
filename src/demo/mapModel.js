/**
 * The demo drive as the server's map endpoints would see it. Pure: every
 * function reads the index and returns new data.
 *
 *   indexTree(literal)            ids, paths and record numbers, once
 *   measure(index, {removed, names})
 *                                 sizes and junk marks for the live tree;
 *                                 names are the Zap tab's folder names
 *   buildPages(index, sized)      every live folder's page, in the shape
 *                                 of the server's childrenPage
 *   offerPicks(index, sized, recNos)
 *                                 picked folders as the server's /map/offer
 *                                 answers them
 *   lockOf(path)                  why the server would refuse a path
 *
 * A folder in `removed` is gone with everything under it: measure skips
 * it, so its ancestors shrink and its page is null.
 */

import { pathKey } from "../pathKey.js";

const DEPTH = 2;
const LIMIT = 40;

export function indexTree(tree) {
  const nodes = [];
  const visit = (lit, parent, inherited) => {
    const id = nodes.length;
    const path = parent ? joinPath(parent.path, lit.name) : lit.name;
    const age = lit.age ?? inherited ?? null;
    const node = {
      id,
      parentId: parent ? parent.id : -1,
      recNo: 5000 + id * 7,
      name: lit.name,
      path,
      own: lit.bytes,
      ownFiles: lit.files,
      junk: lit.junk ?? null,
      label: lit.label ?? null,
      age,
      kids: [],
    };
    nodes.push(node);
    for (const kid of lit.kids) node.kids.push(visit(kid, node, age));
    return id;
  };
  visit(tree, null, null);
  return {
    nodes,
    byPath: new Map(nodes.map((n) => [pathKey(n.path), n.id])),
    byRec: new Map(nodes.map((n) => [n.recNo, n.id])),
  };
}

/**
 * @returns {Array<{bytes, files, junk, junkBytes, cautionBytes, live: number[]}|null>}
 *   by id; null for a removed folder and everything under it
 */
export function measure(index, { removed = new Set(), names = new Set() } = {}) {
  const sized = index.nodes.map(() => null);
  const walk = (id) => {
    const node = index.nodes[id];
    const s = { bytes: node.own, files: node.ownFiles, junkBytes: 0, cautionBytes: 0, live: [] };
    for (const kid of node.kids) {
      if (removed.has(kid)) continue;
      const k = walk(kid);
      s.live.push(kid);
      s.bytes += k.bytes;
      s.files += k.files;
      s.junkBytes += k.junkBytes;
      s.cautionBytes += k.cautionBytes;
    }
    s.live.sort((a, b) => sized[b].bytes - sized[a].bytes);
    s.junk = node.junk ?? (names.has(node.name.toLowerCase()) ? "name-hit" : null);
    if (s.junk) {
      s.junkBytes = s.bytes;
      s.cautionBytes = s.junk === "cache-caution" ? s.bytes : 0;
    }
    sized[id] = s;
    return s;
  };
  if (!removed.has(0)) walk(0);
  return sized;
}

/** @returns {Map<number, object>} id -> page, for every live folder */
export function buildPages(index, sized) {
  const pages = new Map();
  for (const node of index.nodes) {
    if (sized[node.id]) pages.set(node.id, pageOf(index, sized, node.id));
  }
  return pages;
}

export function pageOf(index, sized, id, { depth = DEPTH, limit = LIMIT } = {}) {
  if (!sized[id]) return null;
  return {
    node: describe(index, sized, id),
    trail: trailOf(index, id),
    ...listing(index, sized, id, depth, limit),
  };
}

/** The live folder at a path, or -1. */
export function idOfPath(index, sized, path) {
  const id = index.byPath.get(pathKey(path)) ?? -1;
  return id >= 0 && sized[id] ? id : -1;
}

export function offerPicks(index, sized, recNos) {
  const refused = [];
  const ids = new Set();
  for (const raw of recNos) {
    const id = index.byRec.get(Number(raw)) ?? -1;
    const path = id >= 0 ? index.nodes[id].path : `record ${String(raw)}`;
    const why = id < 0 ? "not in the map" : !sized[id] ? "already deleted" : lockOf(path);
    if (why) refused.push({ path, reason: why });
    else ids.add(id);
  }
  const outer = [...ids].filter((id) => !hasAncestorIn(index, id, ids));
  const items = outer.map((id) => ({
    path: index.nodes[id].path,
    bytes: String(sized[id].bytes),
    recNo: index.nodes[id].recNo,
  }));
  const total = items.reduce((sum, i) => sum + Number(i.bytes), 0);
  return { paths: items.map((i) => i.path), items, bytes: String(total), refused };
}

const SYSTEM = "inside a protected system folder";
const SUBTREES = [
  /^[a-z]:\\(?:windows|program files|program files \(x86\)|programdata\\microsoft)(?:\\|$)/i,
  /^[a-z]:\\users\\(?:public|default)(?:\\|$)/i,
];
const EXACT = [
  { re: /^[a-z]:\\?$/i, reason: "protected system path" },
  { re: /^[a-z]:\\(?:programdata|users)$/i, reason: "protected system path" },
  { re: /^[a-z]:\\users\\[^\\]+$/i, reason: "protected system path" },
  { re: /^[a-z]:\\users\\[^\\]+\\appdata(?:\\(?:local|roaming|locallow))?$/i, reason: "protected system path" },
  {
    re: /^[a-z]:\\users\\[^\\]+\\(?:desktop|documents|downloads|pictures|music|videos|onedrive|source)$/i,
    reason: "protected user folder",
  },
];

/** Why the real server's screen would refuse `path`, or null. */
export function lockOf(path) {
  if (SUBTREES.some((re) => re.test(path))) return SYSTEM;
  return EXACT.find(({ re }) => re.test(path))?.reason ?? null;
}

// ---------------------------------------------------------------------------

function listing(index, sized, id, depth, limit) {
  const children = [];
  const other = { count: 0, bytes: 0 };
  for (const kid of sized[id].live) {
    if (children.length < limit) {
      const row = describe(index, sized, kid);
      if (depth > 1) row.kids = listing(index, sized, kid, depth - 1, limit);
      children.push(row);
    } else {
      other.count += 1;
      other.bytes += sized[kid].bytes;
    }
  }
  const node = index.nodes[id];
  return { children, other, ownFiles: { bytes: node.own, count: node.ownFiles } };
}

function describe(index, sized, id) {
  const node = index.nodes[id];
  const s = sized[id];
  const row = {
    id,
    recNo: node.recNo,
    name: node.name,
    bytes: s.bytes,
    files: s.files,
    junk: s.junk,
    junkBytes: s.junkBytes,
    cautionBytes: s.cautionBytes,
    hasKids: s.live.length > 0,
  };
  if (node.label) row.label = node.label;
  const locked = lockOf(node.path);
  if (locked) row.locked = locked;
  return row;
}

function trailOf(index, id) {
  const out = [];
  for (let a = id; a >= 0; a = index.nodes[a].parentId) out.push({ id: a, name: index.nodes[a].name });
  return out.reverse();
}

function hasAncestorIn(index, id, ids) {
  for (let a = index.nodes[id].parentId; a >= 0; a = index.nodes[a].parentId) {
    if (ids.has(a)) return true;
  }
  return false;
}

function joinPath(parent, name) {
  return parent.endsWith("\\") ? parent + name : `${parent}\\${name}`;
}
