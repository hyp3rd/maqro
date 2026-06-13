"use client";

import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { type ReactNode } from "react";
import {
  motion,
  useAnimationControls,
  useReducedMotion,
  type PanInfo,
} from "motion/react";

/** A row wrapper that turns horizontal swipes into actions. Used to
 *  collapse desktop-y row affordances (a row of icon buttons) into
 *  the gesture every iOS/Android user already knows: swipe-left to
 *  destroy, swipe-right to send-somewhere.
 *
 *  The row is gated on `(pointer: coarse)` — mouse users keep the
 *  explicit buttons, since accidental mouse-drag-to-delete is a
 *  worse failure mode than "swipe doesn't work on my desktop". The
 *  buttons stay in the DOM and remain the source of truth; this
 *  wrapper just adds an alternative path to the same handlers.
 *
 *  Threshold tuning: 80 px OR velocity ≥ 500 px/s — the same numbers
 *  iOS uses for its native swipe-to-delete (UITableView), so it
 *  feels right on muscle memory. The row rubber-bands past the
 *  threshold (dragElastic 0.2) so the user gets tactile feedback
 *  that they're committing the action, then springs back when they
 *  release regardless of which side fires.
 *
 *  Direction lock is on so a swipe that starts vertical (e.g. the
 *  user actually wanted to scroll the list) doesn't accidentally
 *  hijack into a horizontal drag. */
const SWIPE_DISTANCE_PX = 80;
const SWIPE_VELOCITY_PX_PER_S = 500;
const DRAG_LIMIT_PX = 120;

/** Intent → reveal-bar palette. Keep these in step with the rest of
 *  the app's destructive/primary/success surfaces; if you add a new
 *  intent, mirror it in the row buttons it's replacing so the
 *  desktop ✕ and the touch swipe land on the same colour.
 *
 *  `info` exists specifically for "send-somewhere" swipes — the
 *  counterpart to `danger`. It avoids the warning-rose / caution-
 *  amber palette so the user can read the swipe intent in
 *  peripheral vision: red bar = destructive, blue bar = move /
 *  transfer. `primary` was the original counterpart but rendered as
 *  near-white in dark mode, which read as visually identical to a
 *  spinner / loader and was too close to the destructive bar for
 *  glance-readability. */
type SwipeIntent = "danger" | "info" | "primary" | "success" | "neutral";

const INTENT_CLASS: Record<SwipeIntent, string> = {
  danger: "bg-destructive/90 text-destructive-foreground",
  info: "bg-sky-600/90 text-white",
  primary: "bg-primary/90 text-primary-foreground",
  success: "bg-emerald-600/90 text-white",
  neutral: "bg-muted text-muted-foreground",
};

export type SwipeRowProps = {
  children: ReactNode;
  /** Fired when the user swipes RIGHT-to-LEFT past the threshold. */
  onSwipeLeft?: () => void;
  /** Fired when the user swipes LEFT-to-RIGHT past the threshold. */
  onSwipeRight?: () => void;
  /** Reveal bar shown on the row's RIGHT edge as the user swipes
   *  left (the "you're about to fire onSwipeLeft" affordance). */
  leftReveal?: { label: string; intent: SwipeIntent; icon?: ReactNode };
  /** Reveal bar shown on the row's LEFT edge as the user swipes
   *  right. */
  rightReveal?: { label: string; intent: SwipeIntent; icon?: ReactNode };
  /** Applied to the outer wrapper. The inner draggable surface keeps
   *  its own background; pass row-level border / spacing here. */
  className?: string;
  /** Background of the draggable surface itself. Defaults to
   *  `bg-card` since that matches every list-row surface in this
   *  app; pass an override when the row sits on a non-card
   *  background (e.g. inside a sheet). The surface MUST be opaque
   *  or the reveal bars will bleed through at rest. */
  surfaceClassName?: string;
  /** Disable gestures imperatively — useful when the row is in an
   *  edit / busy state and the swipe would race the edit handler. */
  disabled?: boolean;
};

export function SwipeRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftReveal,
  rightReveal,
  className,
  surfaceClassName = "bg-card",
  disabled = false,
}: SwipeRowProps) {
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();
  const isTouch = useCoarsePointer();

  // No gesture wiring at all on mouse / reduced-motion devices.
  // We still apply `surfaceClassName` here because that's where the
  // row's padding + background live — gesture-independent layout.
  // Dropping it (the original bug) collapsed every desktop row to
  // edge-to-edge with no breathing room.
  if (!isTouch || reducedMotion || disabled) {
    return <div className={cn(className, surfaceClassName)}>{children}</div>;
  }

  function handleDragEnd(_: PointerEvent, info: PanInfo) {
    const dx = info.offset.x;
    const vx = info.velocity.x;
    const leftFired =
      onSwipeLeft &&
      (dx <= -SWIPE_DISTANCE_PX || vx <= -SWIPE_VELOCITY_PX_PER_S);
    const rightFired =
      onSwipeRight &&
      (dx >= SWIPE_DISTANCE_PX || vx >= SWIPE_VELOCITY_PX_PER_S);
    // Confirm the committed action with a haptic before the handler
    // runs: left is the destructive side (per this component's
    // contract), right is the send-somewhere side.
    if (leftFired) {
      haptic("warning");
      onSwipeLeft?.();
    } else if (rightFired) {
      haptic("success");
      onSwipeRight?.();
    }
    // Always spring back to centre; the row's actual visual change
    // (deletion, recolor) flows through React state, not the drag
    // animation. Keeping the spring identical for fired / not-fired
    // means the user never sees a "stuck" half-swiped row if their
    // handler is async and hasn't unmounted the row yet.
    void controls.start({
      x: 0,
      transition: { type: "spring", stiffness: 600, damping: 40 },
    });
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Each reveal bar takes only its own half of the row. Earlier
          they both had `w-full` and overlapped completely, so the
          DOM-later one (leftReveal / danger) painted on top of the
          other regardless of swipe direction — that's why a
          swipe-right was showing the red Remove bar instead of the
          blue Send bar. With `w-1/2` they live on opposite halves
          and never compete. */}
      {rightReveal && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 flex w-1/2 items-center gap-2 pl-4 text-xs font-medium",
            INTENT_CLASS[rightReveal.intent],
          )}
        >
          {rightReveal.icon}
          <span className="truncate">{rightReveal.label}</span>
        </div>
      )}
      {leftReveal && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 flex w-1/2 items-center justify-end gap-2 pr-4 text-xs font-medium",
            INTENT_CLASS[leftReveal.intent],
          )}
        >
          <span className="truncate">{leftReveal.label}</span>
          {leftReveal.icon}
        </div>
      )}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -DRAG_LIMIT_PX, right: DRAG_LIMIT_PX }}
        dragElastic={0.2}
        animate={controls}
        onDragEnd={handleDragEnd}
        className={cn("relative", surfaceClassName)}
        // Sidesteps Chrome's pull-to-refresh and horizontal navigation
        // gestures that would otherwise compete with the drag.
        style={{ touchAction: "pan-y" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
