import { useEffect, useRef, useState } from "react";

/**
 * The live content width of an element, for drawings that lay themselves
 * out in pixels. Returns [ref, width]; width is 0 until the first measure.
 */
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
