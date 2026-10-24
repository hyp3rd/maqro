"use client";

import {
  BottomSheetHeader,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import * as React from "react";
import { MORE_SHEET, NAV, type ViewKey } from "./nav";

type Props = {
  current: ViewKey;
  onSelect: (key: ViewKey) => void;
  /** The element that opens the sheet (rendered through `DialogTrigger
   *  asChild`, so it must forward its ref and props to a button). Being the
   *  dialog's trigger is what returns focus to it on close. */
  children: React.ReactElement;
};

/** The phone's "More" destinations (nav registry: `MORE_SHEET`) in the
 *  app's bottom sheet (`DialogContent` + the bottom-sheet header, the same
 *  sheet as the quick-add launcher: grab handle, Close, Escape). Picking one
 *  navigates and closes the sheet; Radix returns focus to the trigger
 *  either way. */
export function MoreSheet({ current, onSelect, children }: Props) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="gap-3">
        <BottomSheetHeader>
          <BottomSheetTitle>More</BottomSheetTitle>
          <DialogDescription className="sr-only">
            Everything that isn&apos;t on the tab bar.
          </DialogDescription>
        </BottomSheetHeader>
        <ul className="grid grid-cols-2 gap-2 pt-1">
          {MORE_SHEET.map((key) => {
            const { label, icon: Icon } = NAV[key];
            const active = key === current;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    haptic("select");
                    onSelect(key);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 text-left text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-brand/40 bg-brand/10 text-brand-text"
                      : "border-border/60 bg-card text-foreground active:bg-muted",
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-5 shrink-0",
                      active ? "text-brand-text" : "text-muted-foreground",
                    )}
                  />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
