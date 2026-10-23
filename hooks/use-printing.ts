"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/** `true` while the page is being laid out for print, between the
 *  window's `beforeprint` and `afterprint` events.
 *
 *  Print layout doesn't fire a ResizeObserver re-render in time, so a
 *  component sized from a live measurement would print at its last screen
 *  size (a phone-width chart centred on an A4 page). Reading this lets it
 *  switch to a print layout first. The update is flushed synchronously
 *  inside `beforeprint`, as React documents for this event; batched, it
 *  would land after the print dialog has captured the page.
 *  https://react.dev/reference/react-dom/flushSync */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    function onBeforePrint() {
      flushSync(() => setPrinting(true));
    }
    function onAfterPrint() {
      setPrinting(false);
    }
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  return printing;
}
