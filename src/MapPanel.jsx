import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog.jsx";
import DeleteRun from "./DeleteRun.jsx";
import FullRescan from "./FullRescan.jsx";
import { bytes } from "./format.js";
import { dropPick, dropRecords, reclaimItems, togglePick } from "./mapPicks.js";
import { drillable } from "./mapView.js";
import MapList from "./MapList.jsx";
import MapTray from "./MapTray.jsx";
import { pathKey } from "./pathKey.js";
import ReclaimPanel from "./ReclaimPanel.jsx";
import { reclaimOf } from "./reclaim.js";
import RootField from "./RootField.jsx";
import ScanTelemetry from "./ScanTelemetry.jsx";
import Treemap from "./Treemap.jsx";
import { useSpaceMap } from "./useSpaceMap.js";
import { useZapFlow } from "./useZapFlow.js";
import Callout from "./ui/Callout.jsx";

const NOUN = ["folder", "folders"];

const PREFETCH = 3;

/**
 * The Map tab: where the space on a drive went, as a treemap beside a
 * ranked list. One MFT read per drive; opening a folder asks the server
 * for that folder's page and reads nothing again.
 */
export default function MapPanel({ root, setRoot, chooseRoot, recentRoots, roots, prefs, onBusy }) {
  const space = useSpaceMap();
  const { page, map } = space;
  const [hoverId, setHoverId] = useState(null);
  const prefetched = useRef(null);


  const open = useCallback((row) => space.show(row.id), [space]);

  // Hovering the map fetches its largest folders once, then whatever the
  // pointer is over, so a click usually lands on a page already here.
  const onHover = useCallback(
    (tile) => {
      setHoverId(tile?.id ?? null);
      if (!tile || !page) return;
      if (prefetched.current !== page) {
        prefetched.current = page;
        page.children
          .filter((c) => c.hasKids)
          .slice(0, PREFETCH)
          .forEach((c) => space.prefetch(c.id));
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

  const [picks, setPicks] = useState(() => new Map());
  // Picks are record numbers of one read. A new read — this tab's, or one
  // the server reports on a 409 — can put other folders under them.
  const readId = map?.read ?? null;
  const [picksRead, setPicksRead] = useState(readId);
  if (picksRead !== readId) {
    setPicksRead(readId);
    setPicks(new Map());
  }
  const selected = useMemo(() => new Set(picks.keys()), [picks]);
  const toggle = useCallback((row) => setPicks((prev) => togglePick(prev, row)), []);
  const [offerRefused, setOfferRefused] = useState([]);
  // pathKey -> record number of what the last offer sent, so a deleted
  // path can leave the tray.
  const offeredRecs = useRef(new Map());

  const onDeleted = useCallback(
    (paths) => {
      const recNos = paths.map((p) => offeredRecs.current.get(pathKey(p))).filter((n) => n !== undefined);
      setPicks((prev) => dropRecords(prev, recNos));
      space.refresh();
    },
    [space],
  );
  const flow = useZapFlow(onDeleted);

  const items = useMemo(() => reclaimItems(picks), [picks]);
  const reclaim = useMemo(
    () => reclaimOf(items, [{ bytes: String(Math.round(map?.stats.rootBytes ?? 0)) }]),
    [items, map],
  );

  const busy = space.reading || flow.planning || flow.deleting;
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  const read = ({ full = false } = {}) => {
    setPicks(new Map());
    setOfferRefused([]);
    flow.setError(null);
    flow.clearRun();
    space.read(root, { patterns: prefs.patterns, disabled: prefs.disabledCaches, full });
  };

  const zap = async () => {
    flow.setError(null);
    setOfferRefused([]);
    try {
      const offer = await space.offer([...picks.values()].map((p) => p.recNo));
      offeredRecs.current = new Map(offer.items.map((i) => [pathKey(i.path), i.recNo]));
      setOfferRefused(offer.refused);
      if (offer.items.length > 0) await flow.preparePlan(offer.items, offer.bytes);
    } catch (e) {
      flow.setError(e.message);
    }
  };

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
        <button className="primary" onClick={() => read()} disabled={space.reading || !root}>
          {space.reading ? "Reading…" : "Read drive"}
        </button>
        <FullRescan onClick={() => read({ full: true })} disabled={space.reading || !root} />
        {space.reading && <button onClick={space.stop}>Stop</button>}
      </section>

      {space.stopped && !space.reading && <Callout tone="info">Stopped.</Callout>}

      <ScanTelemetry
        scan={space.telemetry.state}
        elapsedMs={space.telemetry.elapsedMs}
        drive={driveOf(root)}
      />

      {space.error && <p className="error">{space.error}</p>}
      {flow.error && <p className="error">{flow.error}</p>}

      {offerRefused.length > 0 && (
        <Callout tone="refused" title={`${offerRefused.length} picked ${offerRefused.length === 1 ? "folder" : "folders"} refused`}>
          <ul className="map-refused">
            {offerRefused.map((r) => (
              <li key={r.path}>
                {r.path}: {r.reason}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <DeleteRun run={flow.run} noun={NOUN} />

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
              {page.node.junkBytes > 0 && ` · ${bytes(page.node.junkBytes)} junk`}
            </span>
          </nav>

          <ul className="map-legend" aria-label="Colours">
            <li className="map-key map-key--safe">Safe to delete</li>
            <li className="map-key map-key--caution">Caution</li>
            <li className="map-key map-key--refused">Refused</li>
            <li className="map-key map-key--still">Other folders</li>
          </ul>

          <div className="map-body" aria-busy={space.loading}>
            <Treemap
              page={page}
              extras={extras}
              selected={selected}
              hoverId={hoverId}
              onHover={onHover}
              onOpen={open}
              onToggle={toggle}
            />
            <div className="map-side">
              {picks.size > 0 && (
                <ReclaimPanel
                  reclaim={reclaim}
                  noun={NOUN}
                  permanent={flow.permanent}
                  busy={flow.planning}
                  disabled={flow.deleting}
                  onZap={zap}
                >
                  <MapTray
                    picks={picks}
                    onDrop={(id) => setPicks((prev) => dropPick(prev, id))}
                    onClear={() => setPicks(new Map())}
                  />
                </ReclaimPanel>
              )}
              <MapList
                page={page}
                selected={selected}
                hoverId={hoverId}
                onHover={onHover}
                onOpen={open}
                onUp={up}
                onToggle={toggle}
              />
            </div>
          </div>

          <p className="map-note">Ctrl-click a tile, or tick a row, to pick it for deletion.</p>

          {page.node.id === 0 && map?.stats.volumeUsed === null && (
            <p className="map-note">
              The drive did not report its used space, so this map shows file sizes only.
            </p>
          )}
        </div>
      )}

      {flow.pending && (
        <ConfirmDialog
          plan={flow.pending}
          noun={NOUN}
          anyCaution={reclaim.anyCaution}
          permanent={flow.permanent}
          onPermanentChange={flow.setPermanent}
          onCancel={flow.cancelPlan}
          onConfirm={flow.confirmZap}
        />
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
