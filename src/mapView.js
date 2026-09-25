/**
 * The space map as data: a page from the server turned into positioned
 * tiles, with their labels and tones decided.
 *
 * Two levels: the page's children fill the rect, and each child large
 * enough gets its own children laid out inside it, under a header strip
 * that carries its name. Bytes that are not in a listed child show as
 * their own tiles: "other" (the children past the page limit), "files"
 * (files directly in the folder) and any extra the caller adds (the gap
 * between the volume's used space and what the files add up to).
 *
 * Pure.
 */

import { squarify } from "./squarify.js";

export const HEADER = 18;
export const PAD = 2;
const MIN_NEST = 36;

const CHAR_W = 7;
const LINE_H = 14;
const LABEL_PAD = 4;

/**
 * @param {{children: object[], other: {count: number, bytes: number},
 *          ownFiles: {bytes: number, count: number}}} page
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @param {{extras?: Array<{kind: string, name: string, bytes: number}>}} [opts]
 * @returns {object[]} tiles, parents before their children
 */
export function layoutPage(page, rect, { extras = [] } = {}) {
  const tiles = [];
  for (const placed of squarify(itemsOf(page, extras, "top"), rect)) {
    const tile = toTile(placed, 1);
    tiles.push(tile);
    if (!tile.nested) continue;
    const kids = itemsOf(placed.item.row.kids, [], tile.key);
    for (const child of squarify(kids, innerRect(tile))) {
      tiles.push(toTile(child, 2, tile.key));
    }
  }
  return tiles;
}

/**
 * The colour family of a tile.
 *
 *   safe     a cache with safe risk, or a Zap pattern hit
 *   caution  a cache that costs something to get back
 *   refused  a cache the server screened out: hatched, never picked
 *   still    anything else: a neutral tint by depth
 *
 * @returns {"safe"|"caution"|"refused"|"still"}
 */
export function toneOf(tile) {
  if (tile.kind !== "folder") return "still";
  if (tile.junk === "cache-safe" || tile.junk === "name-hit") return "safe";
  if (tile.junk === "cache-caution") return "caution";
  if (tile.junk === "refused") return "refused";
  return "still";
}

/** The class list for a tile's rect. */
export function tileClass(tile, { selected = false } = {}) {
  const parts = ["map-tile", `map-tile--${toneOf(tile)}`, `map-tile--d${tile.depth}`];
  if (tile.kind !== "folder") parts.push(`map-tile--${tile.kind}`);
  if (!selectable(tile)) parts.push("map-tile--locked");
  if (selected) parts.push("is-selected");
  return parts.join(" ");
}

/** Can the tile be picked for deletion? The server checks again. */
export function selectable(tile) {
  return tile.kind === "folder" && !tile.locked && tile.junk !== "refused";
}

/** Can the tile be opened? */
export function drillable(tile) {
  return tile.kind === "folder" && tile.hasKids === true;
}

/**
 * Shares of a still tile's bytes that junk folders hold, split by risk,
 * each 0..1. Junk tiles are filled whole, so they carry no strip.
 *
 * @returns {{safe: number, caution: number}}
 */
export function junkShare(tile) {
  if (toneOf(tile) !== "still" || !(tile.bytes > 0)) return { safe: 0, caution: 0 };
  const junk = clamp01((tile.junkBytes ?? 0) / tile.bytes);
  const caution = Math.min(junk, clamp01((tile.cautionBytes ?? 0) / tile.bytes));
  return { safe: junk - caution, caution };
}

function clamp01(n) {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

/**
 * Fit a label into a width: whole, cut with an ellipsis, or not at all.
 *
 * @param {string} text
 * @param {number} w
 * @param {number} h
 * @returns {string|null}
 */
export function fitLabel(text, w, h) {
  if (h < LINE_H + LABEL_PAD / 2) return null;
  const room = Math.floor((w - LABEL_PAD * 2) / CHAR_W);
  if (room < 3) return null;
  if (text.length <= room) return text;
  return `${text.slice(0, room - 1)}…`;
}

/** Is there room for a second line (the size) under the name? */
export function fitsSize(tile) {
  const h = tile.depth === 1 && tile.nested ? HEADER : tile.h;
  return h >= LINE_H * 2 + LABEL_PAD && tile.w >= CHAR_W * 7 + LABEL_PAD * 2;
}

// ---------------------------------------------------------------------------

function itemsOf(listing, extras, prefix) {
  const items = listing.children.map((row) => ({
    value: row.bytes,
    kind: "folder",
    key: `${prefix}/${row.id}`,
    row,
  }));
  if (listing.other?.bytes > 0) {
    items.push({
      value: listing.other.bytes,
      kind: "other",
      key: `${prefix}/other`,
      name: `${listing.other.count} more`,
      count: listing.other.count,
    });
  }
  if (listing.ownFiles?.bytes > 0) {
    items.push({
      value: listing.ownFiles.bytes,
      kind: "files",
      key: `${prefix}/files`,
      name: "files here",
      count: listing.ownFiles.count,
    });
  }
  for (const extra of extras) {
    if (extra.bytes > 0) {
      items.push({ value: extra.bytes, kind: extra.kind, key: `${prefix}/${extra.kind}`, name: extra.name });
    }
  }
  return items;
}

function toTile({ item, x, y, w, h }, depth, parent = null) {
  const base = { key: item.key, kind: item.kind, depth, parent, x, y, w, h, bytes: item.value };
  if (item.kind !== "folder") {
    return { ...base, name: item.name, count: item.count ?? null, text: fitLabel(item.name, w, h) };
  }
  const { row } = item;
  const tile = {
    ...base,
    id: row.id,
    recNo: row.recNo,
    name: row.name,
    files: row.files,
    junk: row.junk ?? null,
    junkBytes: row.junkBytes ?? 0,
    cautionBytes: row.cautionBytes ?? 0,
    label: row.label ?? null,
    locked: row.locked ?? null,
    hasKids: row.hasKids === true,
  };
  tile.nested = depth === 1 && hasItems(row.kids) && canNest(tile);
  tile.text = fitLabel(row.name, w, tile.nested ? HEADER : h);
  return tile;
}

function hasItems(listing) {
  if (!listing) return false;
  return (
    listing.children.some((c) => c.bytes > 0) ||
    listing.other?.bytes > 0 ||
    listing.ownFiles?.bytes > 0
  );
}

function canNest(tile) {
  return tile.w >= MIN_NEST + PAD * 2 && tile.h >= MIN_NEST + HEADER + PAD;
}

function innerRect(tile) {
  return {
    x: tile.x + PAD,
    y: tile.y + HEADER,
    w: tile.w - PAD * 2,
    h: tile.h - HEADER - PAD,
  };
}
