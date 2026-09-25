import { createContext, createElement, useContext } from "react";

/**
 * What the app reads the world through: a data source, a preference store,
 * and a clock. main.jsx wires the real ones; the site wires a scripted demo.
 *
 * A source has the functions httpSource.js exports, plus `caps` — what this
 * source can do, so the UI hides controls it cannot back:
 *   {demo, directoryPicker, settings, leaveGuard, permanent, fullRescan, window}
 *
 * `window` means the app sits in a fixed-size frame (the site's demo): the
 * host gives its .rt-app the is-window class, and only the results region
 * scrolls.
 */
const SourceContext = createContext(null);

export function SourceProvider({ source, storage, clock, children }) {
  return createElement(SourceContext.Provider, { value: { source, storage, clock } }, children);
}

function useWorld() {
  const world = useContext(SourceContext);
  if (!world) throw new Error("riptide: render inside a <SourceProvider>");
  return world;
}

export const useSource = () => useWorld().source;
export const useStorage = () => useWorld().storage;
export const useClock = () => useWorld().clock;

export const useCaps = () => useWorld().source.caps;
