import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bytes } from "./format.js";
import { drillable } from "./mapView.js";
import MapList from "./MapList.jsx";
import RootField from "./RootField.jsx";
import ScanTelemetry from "./ScanTelemetry.jsx";
import Treemap from "./Treemap.jsx";
import { useSpaceMap } from "./useSpaceMap.js";
import Callout from "./ui/Callout.jsx";

const PREFETCH = 3;

/**
 * The Map tab: where the space on a drive went, as a treemap beside a
 * ranked list. One MFT read per drive; opening a folder asks the server
 * for that folder's page and reads nothing again.
 */
export default function MapPanel({ root, setRoot, chooseRoot, recentRoots, roots, onBusy }) {
  const space = useSpaceMap();
  const { page, map } = space;
  const [hoverId, setHoverId] = useState(null);
  const prefetched = useRef(null);

  const busy = space.reading;
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const open = useCallback((row) => space.show(row.id), [space]);

  // Hovering the map fetches its largest folders once, then whatever the
  // pointer is over, so a click usually lands on a page already here.
  const onHover = useCallback(
    (tile) => {
      setHoverId(tile?.id ?? null);
      if (!tile || !page) return;
      if (prefetched.current !== page) {
        prefetched.current = page;
        page.children.filter(drillable).slice(0, PREFETCH).forEach((c) => space.prefetch(c.id));
      }
      if (drillable(tile)) space.prefetch(tile.id);
    },
    [page, space],
  );

  const up = useMemo(() => {
    const trail = page?.trail ?? [];
    return trail.length > 1 ? () => space.show(trail[trail.length - 2].id) : null;
  }, [page, space]);

  const extras = useMemo(() => gapTiles(page, map), [page, map]);
  const selected = useMemo(() => new Set(), []);

  return (
    <>
      <section className="controls">
        <RootField
          root={root}
          setRoot={setRoot}
          chooseRoot={chooseRoot}
          roots={roots}
          recent={recentRoots}
          placeholder="C:\"
        />
        <button className="primary" onClick={() => space.read(root)} disabled={space.reading || !root}>
          {space.reading ? "Reading…" : "Read drive"}
        </button>
        {space.reading && <button onClick={space.stop}>Stop</button>}
      </section>

      {space.stopped && !space.reading && <Callout tone="info">Stopped.</Callout>}

      <ScanTelemetry
        scan={space.telemetry.state}
        elapsedMs={space.telemetry.elapsedMs}
        drive={driveOf(root)}
      />

      {space.error && <p className="error">{space.error}</p>}

      {page && (
        <div className="map">
          <nav className="map-crumbs" aria-label="Folder path">
            {page.trail.map((crumb, i) => {
              const last = i === page.trail.length - 1;
              return (
                <button
                  key={crumb.id}
                  className="map-crumb"
                  aria-current={last ? "location" : undefined}
                  disabled={last}
                  onClick={() => space.show(crumb.id)}
                >
                  {crumb.name}
                </button>
              );
            })}
            <span className="map-total">
              {bytes(page.node.bytes)} · {page.node.files.toLocaleString()} files
            </span>
          </nav>

          <div className="map-body" aria-busy={space.loading}>
            <Treemap
              page={page}
              extras={extras}
              selected={selected}
              hoverId={hoverId}
              onHover={onHover}
              onOpen={open}
            />
            <MapList
              page={page}
              selected={selected}
              hoverId={hoverId}
              onHover={onHover}
              onOpen={open}
              onUp={up}
            />
          </div>

          {page.node.id === 0 && map?.stats.volumeUsed === null && (
            <p className="map-note">
              The drive did not report its used space, so this map shows file sizes only.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/**
 * At the drive root, the space the volume says is used but no file
 * accounts for: metadata, the MFT itself, shadow copies, slack. Both
 * figures are from the read, so a later delete does not grow the gap.
 */
function gapTiles(page, map) {
  if (!page || !map || page.node.id !== 0) return [];
  const { volumeUsed, rootBytes } = map.stats;
  if (volumeUsed === null || !(volumeUsed > rootBytes)) return [];
  return [{ kind: "gap", name: "not in files", bytes: volumeUsed - rootBytes }];
}

function driveOf(root) {
  return /^[A-Za-z]:/.exec(root ?? "")?.[0].toUpperCase() ?? null;
}
