"use client";

import { useCallback, useState } from "react";

/** Content-box width (whole CSS px) of an element, kept current with a
 *  ResizeObserver. Attach the returned callback as the element's `ref`.
 *
 *  Width is `null` until the first observation - on the server, before
 *  mount, and where ResizeObserver doesn't exist - so callers render a
 *  width-independent fallback in that window.
 *
 *  A callback ref (stable via useCallback) rather than an effect over a
 *  ref object: it observes whenever the element actually attaches -
 *  including a component that first renders nothing and mounts the
 *  element later - and its returned cleanup (React 19 ref cleanup)
 *  disconnects on detach. State is only set from the observer callback,
 *  which the spec delivers once right after `observe()` for a laid-out
 *  element. Widths are rounded so sub-pixel jitter doesn't re-render.
 *  https://react.dev/reference/react-dom/components/common#ref-callback
 *  https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserverEntry/contentBoxSize */
export function useElementWidth<T extends Element>(): [
  ref: (el: T | null) => (() => void) | undefined,
  width: number | null,
] {
  const [width, setWidth] = useState<number | null>(null);

  const ref = useCallback((el: T | null) => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // contentBoxSize is an array (one entry per fragment); older Firefox
      // shipped a single object, hence the contentRect fallback.
      const box = Array.isArray(entry.contentBoxSize)
        ? entry.contentBoxSize[0]
        : undefined;
      const next = Math.round(box?.inlineSize ?? entry.contentRect.width);
      // A detached or display:none container reports 0: keep the last
      // real width rather than collapsing the consumer.
      if (next > 0) setWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
