"use client";

import { useCallback, useState } from "react";

/** Content-box width from layout: clientWidth (padding box, no scrollbar)
 *  less horizontal padding - the box a ResizeObserver reports. */
function contentBoxWidth(el: Element): number {
  const style = getComputedStyle(el);
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0);
  return Math.round(el.clientWidth - padding);
}

/** Content-box width (whole CSS px) of an element, kept current with a
 *  ResizeObserver. Attach the returned callback as the element's `ref`.
 *
 *  Width is `null` until the element is measured - on the server, before
 *  mount, and where ResizeObserver doesn't exist - so callers render a
 *  width-independent fallback in that window.
 *
 *  A callback ref (stable via useCallback) rather than an effect over a
 *  ref object: it observes whenever the element actually attaches -
 *  including a component that first renders nothing and mounts the
 *  element later - and its returned cleanup (React 19 ref cleanup)
 *  disconnects on detach. State is set once from a layout read as the ref
 *  attaches (so the first paint is already at the real width), then from
 *  the observer callback. Widths are rounded so sub-pixel jitter doesn't
 *  re-render.
 *  https://react.dev/reference/react-dom/components/common#ref-callback
 *  https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserverEntry/contentBoxSize */
export function useElementWidth<T extends Element>(): [
  ref: (el: T | null) => (() => void) | undefined,
  width: number | null,
] {
  const [width, setWidth] = useState<number | null>(null);

  const ref = useCallback((el: T | null) => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    // Measure once now, too. The observer's first entry is set from outside
    // React's commit, so it renders a frame late, and the consumer would paint
    // once at its fallback width first (a chart drawn at 640, then scaled down
    // to half height on a phone). An update made while refs attach is
    // committed before the browser paints. clientWidth is layout size, which
    // a CSS transform on an ancestor (the rotated fullscreen viewer) doesn't
    // distort the way getBoundingClientRect would.
    const initial = contentBoxWidth(el);
    if (initial > 0) setWidth(initial);
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
