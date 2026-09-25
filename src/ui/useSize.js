import { useEffect, useRef, useState } from "react";

const NONE = { width: 0, height: 0 };

/**
 * The live content size of an element, for drawings that lay themselves
 * out in pixels. Returns [ref, {width, height}]; both are 0 until the
 * first measure.
 */
export function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState(NONE);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
