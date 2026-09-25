import { bytes } from "./format.js";

/**
 * The folders picked on the map, wherever they sit in the tree. Each can be
 * taken out again; opening a different folder keeps them.
 *
 * @param {{picks: Map<number, object>, onDrop: (id: number) => void,
 *          onClear: () => void}} props
 */
export default function MapTray({ picks, onDrop, onClear }) {
  if (picks.size === 0) return null;

  return (
    <section className="map-tray" aria-label="Picked folders">
      <ul>
        {[...picks.values()].map((pick) => (
          <li key={pick.id} className="map-pick">
            <span className="map-pick-name" title={pick.name}>
              {pick.name}
            </span>
            <span className="map-pick-size">{bytes(pick.bytes)}</span>
            <button
              className="map-pick-drop"
              onClick={() => onDrop(pick.id)}
              aria-label={`Take ${pick.name} out`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button onClick={onClear}>Clear</button>
    </section>
  );
}
