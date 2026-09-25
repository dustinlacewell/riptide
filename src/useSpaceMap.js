import { useCallback, useMemo, useRef, useState } from "react";
import * as api from "./api.js";
import { useScanStream } from "./useScanStream.js";
import { useStoppable } from "./useStoppable.js";

/**
 * The space map's data: one drive read, and the page on show.
 *
 *   read(root, {patterns, disabled})
 *                read root's drive; shows root's folder when it is done
 *   show(id)     show a folder of the current map
 *   prefetch(id) fetch a folder's page ahead of a click
 *   refresh()    show the current folder again, after a delete
 *   offer(recNos) offer picked folders for deletion
 *
 * Pages are cached by (gen, id). When the server says the map changed, a
 * change to the same read (a delete) keeps the folder on show; a new read
 * starts again at the drive root.
 */
export function useSpaceMap() {
  const run = useStoppable();
  const telemetry = useScanStream();
  const [map, setMap] = useState(null);
  const [page, setPage] = useState(null);
  const [reading, setReading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mapRef = useRef(null);
  const cache = useRef(new Map());

  const adopt = useCallback((next) => {
    mapRef.current = next;
    cache.current.clear();
    setMap(next);
  }, []);

  const fetchPage = useCallback((m, id) => {
    const key = `${m.gen}:${id}`;
    let pending = cache.current.get(key);
    if (!pending) {
      pending = api.mapNode({ drive: m.drive, gen: m.gen, id });
      cache.current.set(key, pending);
      pending.catch(() => cache.current.delete(key));
    }
    return pending;
  }, []);

  const show = useCallback(
    async function showPage(id) {
      const m = mapRef.current;
      if (!m) return;
      setLoading(true);
      try {
        const next = await fetchPage(m, id);
        if (mapRef.current !== m) return;
        setPage(next);
        setError(null);
      } catch (e) {
        if (mapRef.current !== m) return;
        if (e.stale) {
          adopt({ ...m, gen: e.stale.gen, read: e.stale.read });
          return await showPage(e.stale.read === m.read ? id : 0);
        }
        // The folder went in a delete: fall back to the top.
        if (e.status === 404 && id !== 0) return await showPage(0);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [adopt, fetchPage],
  );

  const prefetch = useCallback(
    (id) => {
      const m = mapRef.current;
      if (m) fetchPage(m, id).catch(() => {});
    },
    [fetchPage],
  );

  // After a delete the server's map has moved on; skip the cache so the
  // request can find that out.
  const refresh = useCallback(() => {
    if (!page) return;
    cache.current.clear();
    show(page.node.id);
  }, [page, show]);

  // A delete between the pick and the offer changes the gen, not the ids,
  // so the same picks are offered once more under the new gen.
  const offer = useCallback(
    async (recNos) => {
      const m = mapRef.current;
      if (!m) throw new Error("read a drive first");
      try {
        return await api.mapOffer({ drive: m.drive, gen: m.gen, recNos });
      } catch (e) {
        if (!e.stale || e.stale.read !== m.read) throw e;
        adopt({ ...m, gen: e.stale.gen });
        return api.mapOffer({ drive: m.drive, gen: e.stale.gen, recNos });
      }
    },
    [adopt],
  );

  const read = useCallback(
    async (root, { patterns, disabled } = {}) => {
      const signal = run.begin();
      setReading(true);
      setError(null);
      telemetry.start();
      try {
        const done = await api.mapRead({ root, patterns, disabled }, telemetry.note, signal);
        if (done.failure) {
          telemetry.reset();
          setError(done.failure);
          return;
        }
        telemetry.finish({ strategy: "mft", stats: done.stats, elapsedMs: done.stats.totalMs });
        adopt({
          drive: done.drive,
          gen: done.gen,
          read: done.read,
          rootId: done.rootId,
          stats: done.stats,
        });
        setPage(null);
        await show(done.rootId);
      } catch (e) {
        telemetry.reset();
        if (!run.settle(e, signal)) setError(e.message);
      } finally {
        setReading(false);
      }
    },
    [adopt, run, show, telemetry],
  );

  return useMemo(
    () => ({
      map,
      page,
      reading,
      loading,
      error,
      telemetry,
      stopped: run.stopped,
      stop: run.stop,
      read,
      show,
      prefetch,
      refresh,
      offer,
    }),
    [map, page, reading, loading, error, telemetry, run.stopped, run.stop, read, show, prefetch, refresh, offer],
  );
}
