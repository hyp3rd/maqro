"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ReactNode } from "react";

/** The app's one destructive-confirm shell — "are you sure?" with a Cancel
 *  and a destructive-styled action. This exact AlertDialog arrangement was
 *  hand-copied across eight views (and had already drifted: one copy
 *  hard-coded red instead of the `destructive` theme token). Callers keep
 *  their own `pendingX` state and derive `title`/`description` from it;
 *  clearing that state belongs in `onOpenChange(false)`, which Radix fires
 *  on confirm and cancel alike. */
export function DestructiveConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel = "Delete",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ReactNode (not string): several callers interpolate the doomed item's
   *  name into the title. */
  title: ReactNode;
  description: ReactNode;
  actionLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
