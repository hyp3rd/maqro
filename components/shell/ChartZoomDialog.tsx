"use client";

import { ChartFullscreen } from "@/components/shell/ChartFullscreen";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import * as React from "react";
import { Maximize2 } from "lucide-react";
import { AnimatePresence } from "motion/react";

/** Expand-to-fullscreen wrapper for the SVG charts in ProgressView.
 *
 *  Why this exists: a 60-day series is dense in a ~340 px portrait
 *  card even with true-size labels. Real pinch-to-zoom on an inline
 *  SVG would mean a custom touch-handler stack (transform math,
 *  momentum, double-tap, edge-clamp); expanding into a larger view
 *  achieves the same intent — "let me see this bigger" — with a
 *  fraction of the complexity.
 *
 *  Composition: the parent renders the small chart inside this
 *  component as `children`, with an Expand button in its top-right
 *  corner (always shown on touch, on hover / focus with a mouse). On
 *  click, the same `children` re-render inside the fullscreen view —
 *  no separate chart instance, no data re-fetch, no risk of the two
 *  views drifting. */

type Props = {
  /** The inline (small) chart. Rendered as-is in the page; cloned
   *  into the dialog via React's portal-rendered subtree. */
  children: React.ReactNode;
  /** Modal title — usually the section title ("Weight",
   *  "Calorie adherence"). */
  title: string;
  /** Short helper line shown in the dialog header. */
  description?: string;
};

export function ChartZoomDialog({ children, title, description }: Props) {
  const [open, setOpen] = React.useState(false);
  // Touch devices get the fullscreen, landscape, pinch-zoomable viewer
  // (a 60-day series is unreadable in a portrait card). Mouse/desktop
  // keeps the simpler widened modal — there's already screen real
  // estate and no pinch gesture.
  const isCoarse = useCoarsePointer();

  return (
    <>
      {/* The expand control sits beside the chart, not around it: a
          <button> may only hold phrasing content and makes its children
          presentational, which would hide the chart's accessible summary
          and data-table disclosure from assistive tech (and nest one
          interactive control inside another). Touch users tap the chart
          for its tooltip and this button to expand. */}
      <div className="group/chart relative">
        {children}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute right-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/chart:opacity-100 coarse:h-11 coarse:w-11 coarse:-translate-y-2 coarse:translate-x-2"
          aria-label={`Expand ${title}`}
        >
          <Maximize2
            className="h-3.5 w-3.5"
            aria-hidden
          />
        </button>
      </div>

      {isCoarse ? (
        // Mounted only while open so its pan/zoom state starts fresh;
        // AnimatePresence lets the close flip play before unmount.
        <AnimatePresence>
          {open && (
            <ChartFullscreen
              key="chart-fullscreen"
              onClose={() => setOpen(false)}
              title={title}
            >
              {children}
            </ChartFullscreen>
          )}
        </AnimatePresence>
      ) : (
        <Dialog
          open={open}
          onOpenChange={setOpen}
        >
          {/* Desktop: widen the modal so the chart breathes. The chart
              measures its container and redraws at the new width — no
              separate "large" variant needed. */}
          <DialogContent className="max-w-[95vw] sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>
            <div className="py-3">{children}</div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
