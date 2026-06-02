"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { motion } from "motion/react";

/** Track portrait vs landscape so we only rotate the chart 90° when the
 *  viewport is portrait. If the user has orientation unlocked and turns
 *  the phone, the browser re-lays-out to landscape and we render the
 *  chart upright + full-width instead (rotating again would double up). */
function subscribeOrientation(cb: () => void) {
  const mq = window.matchMedia("(orientation: portrait)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsPortrait(): boolean {
  return useSyncExternalStore(
    subscribeOrientation,
    () => window.matchMedia("(orientation: portrait)").matches,
    () => true,
  );
}

type Props = {
  onClose: () => void;
  title: string;
  /** The same chart subtree rendered inline — re-rendered here at a
   *  landscape size. */
  children: React.ReactNode;
};

type Transform = { scale: number; x: number; y: number };
const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };
const MIN_SCALE = 1;
const MAX_SCALE = 6;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Fullscreen, landscape, pinch-zoomable chart viewer for touch.
 *
 *  A 60-day series is unreadable in a ~340px portrait card. Tapping
 *  expand opens this overlay: the chart is rotated 90° so the time axis
 *  runs along the phone's long edge (no need to physically turn the
 *  device), and a two-finger pinch zooms while a one-finger drag pans —
 *  double-tap (or the reset button) returns to the fitted view.
 *
 *  Implementation: a `transform: translate() scale()` on the stage,
 *  origin-center, driven by pointer events in screen space — so the
 *  pinch math is unaffected by the inner 90° rotation. Portal to
 *  <body> to escape any clipping/stacking ancestor (same rationale as
 *  CameraSheet). */
export function ChartFullscreen({ onClose, title, children }: Props) {
  const [t, setT] = useState<Transform>(IDENTITY);
  const stageRef = useRef<HTMLDivElement>(null);
  // Live pointer positions by id; gesture state snapshots taken at the
  // start of a pinch / pan so movement is measured as a delta.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    dist: number;
    mid: { x: number; y: number };
    start: Transform;
  } | null>(null);
  const pan = useRef<{ p: { x: number; y: number }; start: Transform } | null>(
    null,
  );
  const lastTap = useRef(0);
  const portrait = useIsPortrait();

  // Lock body scroll and wire Escape, matching CameraSheet /
  // FoodSearchSheet. The overlay is mounted only while open (by the
  // parent, via AnimatePresence), so transform state starts fresh from
  // `IDENTITY` — no reset effect needed.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Both only run with ≥2 active pointers; the guard satisfies
  // noUncheckedIndexedAccess without a non-null assertion.
  function twoPointers() {
    const pts = [...pointers.current.values()];
    return pts.length >= 2 ? ([pts[0], pts[1]] as const) : null;
  }
  function midpoint() {
    const tp = twoPointers();
    if (!tp || !tp[0] || !tp[1]) return { x: 0, y: 0 };
    return { x: (tp[0].x + tp[1].x) / 2, y: (tp[0].y + tp[1].y) / 2 };
  }
  function distance() {
    const tp = twoPointers();
    if (!tp || !tp[0] || !tp[1]) return 1;
    return Math.hypot(tp[0].x - tp[1].x, tp[0].y - tp[1].y);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Double-tap (single finger) → reset to the fitted view.
    if (pointers.current.size === 1) {
      const now = e.timeStamp;
      if (now - lastTap.current < 300) {
        setT(IDENTITY);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
    pinch.current = null;
    pan.current = null;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const count = pointers.current.size;

    if (count >= 2) {
      const dist = distance();
      const mid = midpoint();
      if (!pinch.current) {
        pinch.current = { dist, mid, start: t };
        return;
      }
      const g = pinch.current;
      const scale = clamp(
        g.start.scale * (dist / g.dist),
        MIN_SCALE,
        MAX_SCALE,
      );
      setT({
        scale,
        x: g.start.x + (mid.x - g.mid.x),
        y: g.start.y + (mid.y - g.mid.y),
      });
    } else if (count === 1 && t.scale > 1) {
      const p = { x: e.clientX, y: e.clientY };
      if (!pan.current) {
        pan.current = { p, start: t };
        return;
      }
      const g = pan.current;
      setT({
        scale: g.start.scale,
        x: g.start.x + (p.x - g.p.x),
        y: g.start.y + (p.y - g.p.y),
      });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    pan.current = null;
    // A pinch that ended below the fit threshold snaps back to fitted.
    if (pointers.current.size === 0 && t.scale <= 1) setT(IDENTITY);
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[70] flex flex-col bg-background pt-safe"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-3">
        <p className="truncate text-sm font-semibold text-foreground">
          {title}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setT(IDENTITY)}
            aria-label="Reset zoom"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors active:bg-muted"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors active:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative flex flex-1 touch-none select-none items-center justify-center overflow-hidden"
      >
        <div
          className="will-change-transform"
          style={{
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
          }}
        >
          {/* Portrait: rotate the chart 90° so its time axis uses the
              phone's long (vertical) edge — width tied to viewport
              height so the rotated chart fills the screen. Landscape:
              render upright, full-width. The rotation animates in (and
              back out) for a native "flip to landscape" feel. */}
          <motion.div
            className="origin-center"
            style={{ width: portrait ? "86dvh" : "94vw" }}
            initial={{ rotate: 0, scale: 0.86 }}
            animate={{ rotate: portrait ? 90 : 0, scale: 1 }}
            exit={{ rotate: 0, scale: 0.86 }}
            transition={{ type: "spring", stiffness: 230, damping: 26 }}
          >
            {children}
          </motion.div>
        </div>
      </div>

      <p className="border-t border-border/60 py-2 text-center text-[11px] text-muted-foreground pb-safe">
        Pinch to zoom · drag to pan · double-tap to reset
      </p>
    </motion.div>,
    document.body,
  );
}
