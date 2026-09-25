import { useMemo } from "react";
import { bytes } from "./format.js";
import {
  HEADER,
  drillable,
  fitsSize,
  junkShare,
  layoutPage,
  selectable,
  tileClass,
  toneOf,
} from "./mapView.js";
import { useWidth } from "./ui/useWidth.js";

const STRIP = 3;

/**
 * The space map drawn: one folder's children as tiles sized by bytes, and
 * their children inside them.
 *
 * Click a tile to open it. Ctrl- or Shift-click picks it for deletion. The
 * ranked list beside the map carries the same actions for the keyboard and
 * for screen readers, so the drawing itself is hidden from them.
 *
 * @param {{page: object, extras?: object[], selected: Set<number>,
 *          hoverId: number|null, onHover: (tile: object|null) => void,
 *          onOpen: (tile: object) => void, onToggle?: (tile: object) => void}} props
 */
export default function Treemap({ page, extras, selected, hoverId, onHover, onOpen, onToggle }) {
  const [ref, width] = useWidth();
  const height = Math.round(Math.min(640, Math.max(320, width * 0.62)));

  const tiles = useMemo(
    () => (width > 0 ? layoutPage(page, { x: 0, y: 0, w: width, h: height }, { extras }) : []),
    [page, extras, width, height],
  );

  const click = (tile, e) => {
    if ((e.ctrlKey || e.metaKey || e.shiftKey) && onToggle) {
      if (selectable(tile)) onToggle(tile);
      return;
    }
    if (drillable(tile)) onOpen(tile);
  };

  return (
    <div className="treemap" ref={ref} onPointerLeave={() => onHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs>
            <pattern id="map-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="map-hatch-line" x1="0" y1="0" x2="0" y2="6" />
            </pattern>
          </defs>
          {tiles.map((tile) => (
            <Tile
              key={tile.key}
              tile={tile}
              selected={tile.id !== undefined && selected.has(tile.id)}
              hovered={tile.id !== undefined && tile.id === hoverId}
              onEnter={() => onHover(tile)}
              onClick={(e) => click(tile, e)}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

function Tile({ tile, selected, hovered, onEnter, onClick }) {
  const share = junkShare(tile);
  const strip = share.safe + share.caution > 0 && tile.h > STRIP * 3;
  const stripY = tile.y + tile.h - STRIP;
  const labelY = tile.y + 13;

  return (
    <g
      className={`${tileClass(tile, { selected })}${hovered ? " is-hovered" : ""}${drillable(tile) ? " is-drillable" : ""}`}
      onPointerEnter={(e) => {
        e.stopPropagation();
        onEnter();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <rect className="map-tile-fill" x={tile.x} y={tile.y} width={tile.w} height={tile.h} />
      {tile.nested && (
        <rect className="map-tile-head" x={tile.x} y={tile.y} width={tile.w} height={HEADER} />
      )}
      {toneOf(tile) === "refused" && (
        <rect className="map-tile-hatch" x={tile.x} y={tile.y} width={tile.w} height={tile.h} />
      )}
      {strip && (
        <>
          <rect
            className="map-tile-strip map-tile-strip--safe"
            x={tile.x}
            y={stripY}
            width={tile.w * share.safe}
            height={STRIP}
          />
          <rect
            className="map-tile-strip map-tile-strip--caution"
            x={tile.x + tile.w * share.safe}
            y={stripY}
            width={tile.w * share.caution}
            height={STRIP}
          />
        </>
      )}
      {tile.text && (
        <text className="map-tile-label" x={tile.x + 4} y={labelY}>
          {tile.text}
          {fitsSize(tile) && !tile.nested && (
            <tspan className="map-tile-size" x={tile.x + 4} dy={14}>
              {bytes(tile.bytes)}
            </tspan>
          )}
        </text>
      )}
      <title>{`${tile.name} · ${bytes(tile.bytes)}`}</title>
    </g>
  );
}
