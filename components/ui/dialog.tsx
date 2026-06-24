"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** Distance (px) the sheet must be dragged down before release dismisses it. */
const SWIPE_CLOSE_THRESHOLD = 80;

/** Dialog content with a mobile-first bottom-sheet behavior.
 *
 *  On phones (< sm) the panel pins to the bottom edge, fills the width,
 *  rounds only the top corners, slides up on open and back down on
 *  close - the standard iOS / Android action-sheet idiom. It also
 *  caps its height at 90vh and scrolls overflow inside so a tall form
 *  doesn't push the close affordance off-screen. The grab handle at the
 *  top is a real drag-to-dismiss target: dragging it down past
 *  `SWIPE_CLOSE_THRESHOLD` closes the sheet (Radix has no native
 *  drag-to-dismiss, so we drive a hidden Close on release). Tapping the
 *  overlay or the X still works too. The handle is a centred strip so it
 *  never overlaps the top-right X.
 *
 *  On sm+ it falls back to the original centered-modal layout (the handle
 *  + drag are mobile-only). */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, ...props }, ref) => {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const startY = React.useRef<number | null>(null);
  const [dragY, setDragY] = React.useState(0);

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    // Only downward travel counts; an upward drag does nothing.
    setDragY(Math.max(0, e.clientY - startY.current));
  };
  const endDrag = () => {
    if (startY.current === null) return;
    const shouldClose = dragY > SWIPE_CLOSE_THRESHOLD;
    startY.current = null;
    setDragY(0);
    if (shouldClose) closeRef.current?.click();
  };

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // `dragY` is only ever non-zero from the mobile handle (hidden on sm+),
        // so the inline transform never fights the desktop centering transform.
        style={
          dragY > 0 ? { ...style, transform: `translateY(${dragY}px)` } : style
        }
        className={cn(
          // Common to both layouts. The combination of `grid` +
          // `[&>*]:min-w-0` is the actual fix for the horizontal-
          // overflow problem; `overflow-x-hidden` is a safety net
          // for any deeper grandchild that still escapes.
          //
          // Why both: DialogContent is `display: grid`, and grid
          // tracks size to children's `min-content` width by default.
          // Any descendant with a wide intrinsic minimum — a long
          // URL with no spaces in a `<Textarea>`, a number input's
          // spinner floor, a `<table>` with fixed columns — would
          // otherwise expand the grid track past the dialog's
          // `max-w-*` cap, dragging form labels and inputs past the
          // visible right edge (RecipeForm, DetailPanel were the
          // worst offenders). Applying `min-width: 0` to every
          // direct child via the arbitrary-variant `[&>*]:min-w-0`
          // tells the grid algorithm "let children be smaller than
          // their min-content" — they then respect the dialog's
          // bounds and clip/scroll their own internal overflow.
          // `overflow-x-hidden` catches anything the `min-w-0`
          // doesn't reach (e.g. a grandchild with explicit width).
          "fixed z-50 grid gap-4 overflow-x-hidden border bg-background shadow-lg duration-200 [&>*]:min-w-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          // Mobile: bottom sheet. inset-x-0 → full width. bottom-0 → glue
          // to viewport bottom. pb-safe → clear the iOS home indicator.
          // max-h-[90vh] + overflow-y-auto → scroll long forms inside the
          // sheet rather than off-screen. slide-in/out-to-bottom for the
          // panel motion.
          "inset-x-0 bottom-0 max-h-[90vh] w-full overflow-y-auto rounded-t-2xl px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-6",
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          // Desktop (sm+): centered modal. Override the bottom-sheet
          // bottom/inset-x/rounding/padding so the original look
          // returns. We KEEP `max-h-[90vh] + overflow-y-auto` from the
          // mobile rules (just relaxing the cap to 90 vh of the
          // desktop viewport) - long forms like RecipeForm with many
          // ingredients used to punch through the viewport bottom on
          // desktop because the previous `sm:max-h-none sm:overflow-
          // visible` opted out of any height management.
          "sm:inset-x-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:max-h-[90vh] sm:w-full sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:overflow-y-auto sm:rounded-lg sm:p-6",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%] sm:data-[state=closed]:slide-in-from-bottom-0 sm:data-[state=open]:slide-out-to-bottom-0",
          className,
        )}
        {...props}
      >
        {/* Hidden Close, driven by the drag-to-dismiss gesture below. Radix
          has no programmatic-close API on Content, so a swipe past the
          threshold clicks this. Kept out of the tab order + a11y tree;
          the visible X and the overlay remain the discoverable controls. */}
        <DialogPrimitive.Close
          ref={closeRef}
          aria-hidden
          tabIndex={-1}
          className="sr-only"
        />
        {/* Mobile grab handle - a real drag-to-dismiss target. The hit area
          is a centred strip (not full-width) so it never sits over the
          top-right X. `touch-none` stops the browser treating the drag as
          a scroll. Hidden on sm+ where the centered-modal layout has no
          sheet to dismiss. */}
        <div
          aria-hidden
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute left-1/2 top-0 z-10 flex h-6 w-24 -translate-x-1/2 cursor-grab touch-none items-start justify-center pt-2 sm:hidden"
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

/** Same stacked-on-mobile / row-on-sm layout as AlertDialogFooter.
 *  Buttons grow to full width on mobile so the thumb-target is
 *  unmistakable; sm+ falls back to right-aligned compact buttons. */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-2 [&_button]:w-full sm:flex-row sm:justify-end sm:gap-2 sm:[&_button]:w-auto",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
