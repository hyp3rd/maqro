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
import { useTranslations } from "next-intl";

export type UnsyncedChangesDialogProps = {
  open: boolean;
  /** Unsynced changes at risk; `0` means "unknown, but not verified synced". */
  count: number;
  /** Disables both actions while the confirmed action runs. */
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Warns before signing out wipes local changes that never reached the
 *  server. Shared by every user-initiated sign-out entry point (see
 *  `useSafeSignOut`): cancelling keeps the user signed in, confirming signs
 *  out and wipes this device's data. Dismissing (Escape / overlay) is always
 *  the non-destructive choice. */
export function UnsyncedChangesDialog({
  open,
  count,
  busy,
  onCancel,
  onConfirm,
}: UnsyncedChangesDialogProps) {
  const t = useTranslations("signOutGuard");
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Cancel button, Escape and overlay all land here.
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("signOut.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("changes", { count })} {t("signOut.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("signOut.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog open (and skip onOpenChange → onCancel)
              // until the confirmed action navigates away.
              e.preventDefault();
              onConfirm();
            }}
            disabled={busy}
            className="bg-destructive-strong text-destructive-foreground hover:bg-destructive-strong/90"
          >
            {t("signOut.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
