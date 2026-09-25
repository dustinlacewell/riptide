import { useRef } from "react";
import { bytes } from "./format.js";
import { drillable, selectable, toneOf } from "./mapView.js";
import { cls } from "./ui/cls.js";

/**
 * The folder on show as a ranked list, largest first: the map's keyboard
 * and screen-reader face.
 *
 *   Up / Down   move between rows
 *   Enter       open the folder
 *   Space       pick it for deletion (when it can be picked)
 *   Backspace   go up one folder
 *
 * @param {{page: object, selected: Set<number>, hoverId: number|null,
 *          onHover: (row: object|null) => void, onOpen: (row: object) => void,
 *          onUp?: () => void, onToggle?: (row: object) => void}} props
 */
export default function MapList({ page, selected, hoverId, onHover, onOpen, onUp, onToggle }) {
  const listRef = useRef(null);
  const total = page.node.bytes;
  const rows = page.children.map((row) => ({ ...row, kind: "folder", depth: 1 }));

  const onKeyDown = (e) => {
    if (e.key === "Backspace" && onUp) {
      e.preventDefault();
      onUp();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = [...listRef.current.querySelectorAll(".map-row-open")];
    const at = buttons.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? at + 1 : at - 1;
    if (next >= 0 && next < buttons.length) {
      e.preventDefault();
      buttons[next].focus();
    }
  };

  return (
    <div className="map-list" onKeyDown={onKeyDown} onPointerLeave={() => onHover(null)}>
      <ol ref={listRef} aria-label={`Folders in ${page.node.name}, largest first`}>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            share={total > 0 ? row.bytes / total : 0}
            selected={selected.has(row.id)}
            hovered={row.id === hoverId}
            onHover={onHover}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
        {page.other.count > 0 && (
          <li className="map-row map-row--misc">
            <span className="map-row-name">{page.other.count.toLocaleString()} more folders</span>
            <span className="map-row-size">{bytes(page.other.bytes)}</span>
          </li>
        )}
        {page.ownFiles.count > 0 && (
          <li className="map-row map-row--misc">
            <span className="map-row-name">{page.ownFiles.count.toLocaleString()} files here</span>
            <span className="map-row-size">{bytes(page.ownFiles.bytes)}</span>
          </li>
        )}
      </ol>
    </div>
  );
}

function Row({ row, share, selected, hovered, onHover, onOpen, onToggle }) {
  const tone = toneOf(row);
  const canPick = selectable(row) && onToggle;
  const canOpen = drillable(row);

  return (
    <li
      className={cls("map-row", `map-row--${tone}`, hovered && "is-hovered", selected && "is-selected")}
      onPointerEnter={() => onHover(row)}
    >
      <span className="map-row-pick">
        {canPick && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(row)}
            aria-label={`Pick ${row.name} for deletion`}
          />
        )}
      </span>
      <button
        className="map-row-open"
        onClick={() => canOpen && onOpen(row)}
        onFocus={() => onHover(row)}
        onKeyDown={(e) => {
          if (e.key === " " && canPick) {
            e.preventDefault();
            onToggle(row);
          }
        }}
        aria-disabled={!canOpen}
        title={row.locked ?? row.label ?? row.name}
      >
        <span className="map-row-name">{row.name}</span>
        {row.label && <span className="map-row-label">{row.label}</span>}
      </button>
      <span className="map-row-size">{bytes(row.bytes)}</span>
      <span className="map-row-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
      </span>
    </li>
  );
}
