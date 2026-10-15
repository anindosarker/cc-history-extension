import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

// useLayoutEffect warns during server rendering (tests), useEffect would flash the wide layout in the browser.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Width of an element in CSS pixels, tracked with a ResizeObserver.
 * Undefined until the first measurement (and always on the server).
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // Border-box width, the same measure as the initial read above.
      setWidth(el.getBoundingClientRect().width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
