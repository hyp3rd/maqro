"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Selector for everything the Tab trap counts as focusable. Queried at
 *  keydown time, not cached — the sheets render results/phases dynamically. */
const TABBABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Everything a full-screen `createPortal` overlay needs to actually behave
 *  like the modal dialog its `aria-modal="true"` claims (Radix does all of
 *  this for the in-tree dialogs; the custom portals did none of it):
 *
 *    - body scroll-lock (html + body — mobile Safari rubber-bands otherwise)
 *    - Escape → `onClose`
 *    - initial focus INTO the overlay (honoring an autofocused element if the
 *      sheet already placed one; otherwise the container itself, so screen
 *      readers announce its `aria-label` — give the container `tabIndex={-1}`)
 *    - a Tab/Shift+Tab trap that wraps within the overlay's tabbables and
 *      pulls focus back in if it ever escapes to the covered page
 *    - focus restore to the previously-focused element on close, so a
 *      keyboard user lands back on the button that opened the sheet
 *
 *  The four custom overlays (food search, camera, pantry scan, fullscreen
 *  chart) previously hand-copied the scroll-lock + Escape half of this and
 *  skipped focus entirely. */
export function useModalOverlay(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  // Track the latest onClose without re-running the main effect when a
  // caller passes a fresh closure each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const prevHtmlOverflow = htmlEl.style.overflow;
    const prevBodyOverflow = bodyEl.style.overflow;
    htmlEl.style.overflow = "hidden";
    bodyEl.style.overflow = "hidden";

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // React commits autoFocus before effects run, so an overlay that wants
    // focus on a specific input (the search box) keeps it; otherwise focus
    // the container so the dialog announces itself.
    if (!container.contains(document.activeElement)) {
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const tabbables = Array.from(
        container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null);
      if (tabbables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const active = document.activeElement;
      const inside = container.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last?.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      htmlEl.style.overflow = prevHtmlOverflow;
      bodyEl.style.overflow = prevBodyOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, containerRef]);
}
