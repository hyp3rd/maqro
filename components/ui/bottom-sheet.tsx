"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { DialogHeader, DialogTitle } from "./dialog";

/* The app's one bottom-sheet language. On a phone `DialogContent` is the
 * sheet itself: the grab handle you drag down to dismiss, the 44px Close
 * button top-right, Escape and an overlay tap to close (Radix), rounded top
 * corners and the home-indicator inset. These two set its header the same
 * way everywhere: left-aligned (DialogHeader centres on phones, the alert
 * idiom), and the title at one size, clear of the Close button, with a line
 * height that survives a wrap ("Add to Afternoon snack · Today").
 *
 * Use them inside `DialogContent` for the sheets the tab bar opens (More,
 * the quick-add launcher) and any sheet that should read like them. */

function BottomSheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <DialogHeader
      className={cn("space-y-1 text-left", className)}
      {...props}
    />
  );
}

function BottomSheetTitle({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof DialogTitle>) {
  return (
    <DialogTitle
      className={cn("pr-8 text-lg leading-tight", className)}
      {...props}
    />
  );
}

export { BottomSheetHeader, BottomSheetTitle };
