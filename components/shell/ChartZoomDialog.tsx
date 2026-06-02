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

/** Tap-to-expand wrapper for the SVG charts in ProgressView.
 *
 *  Why this exists: the charts render at ~140 px tall on a 375 px
 *  viewport, which makes axis labels feel cramped. Real pinch-to-
 *  zoom on a custom SVG would mean a custom touch-handler stack
 *  (transform math, momentum, double-tap, edge-clamp) and even then
 *  is fiddly on a chart that small. Tap-to-fullscreen achieves the
 *  same intent — "let me see this bigger" — with a fraction of the
 *  complexity and reads more naturally on touch.
 *
 *  Composition: the parent renders the small chart inside this
 *  component as `children`. The wrapper makes the area pressable
 *  and shows an Expand icon on hover. On click, the same `children`
 *  re-render inside the fullscreen Dialog — no separate chart
 *  instance, no data re-fetch, no risk of the two views drifting. */

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The button wraps the chart and stretches to its bounds.
        // `block w-full` because the chart's SVG is already
        // `w-full h-auto`; we don't want to add any layout
        // overhead. Group + hover surfaces the Expand affordance
        // only when the pointer's there — chart stays clean by
        // default. On touch (no hover), the affordance becomes a
        // small static pill that's always visible (`group-active`).
        className="group relative block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Expand ${title}`}
      >
        {children}
        <span
          className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-1 text-[10px] font-medium text-muted-foreground opacity-100 backdrop-blur transition-opacity group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100"
          aria-hidden
        >
          <Maximize2 className="h-3 w-3" />
        </span>
      </button>

      {isCoarse ? (
        // Mounted only while open so its pan/zoom state starts fresh.
        open && (
          <ChartFullscreen
            open
            onClose={() => setOpen(false)}
            title={title}
          >
            {children}
          </ChartFullscreen>
        )
      ) : (
        <Dialog
          open={open}
          onOpenChange={setOpen}
        >
          {/* Desktop: widen the modal so the chart breathes. The SVG
              uses viewBox + `w-full h-auto`, so it scales to fill the
              new container — no separate "large" variant needed. */}
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
