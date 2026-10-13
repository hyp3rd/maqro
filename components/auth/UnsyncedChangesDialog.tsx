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
  /** Why the dialog is shown:
   *   - `sign-out`: the user asked to sign out; cancelling keeps them signed
   *     in, confirming signs out and wipes this device's data.
   *   - `account-mismatch`: the session was already ended (a passkey step-up
   *     resolved to a different account); cancelling keeps the local data,
   *     confirming discards it. */
  reason: "sign-out" | "account-mismatch";
  /** Disables both actions while the confirmed action runs. */
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Warns before an action wipes local changes that never reached the server.
 *  Shared by every sign-out entry point (see `useSafeSignOut`) and the MFA
 *  dialog's wrong-account bail-out. Dismissing (Escape / overlay) is always
 *  the non-destructive choice. */
export function UnsyncedChangesDialog({
  open,
  count,
  reason,
  busy,
  onCancel,
  onConfirm,
}: UnsyncedChangesDialogProps) {
  const t = useTranslations("signOutGuard");
  const signOut = reason === "sign-out";
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
          <AlertDialogTitle>
            {signOut ? t("signOut.title") : t("accountMismatch.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("changes", { count })}{" "}
            {signOut ? t("signOut.body") : t("accountMismatch.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {signOut ? t("signOut.cancel") : t("accountMismatch.keep")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog open (and skip onOpenChange → onCancel)
              // until the confirmed action navigates away.
              e.preventDefault();
              onConfirm();
            }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {signOut ? t("signOut.confirm") : t("accountMismatch.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
