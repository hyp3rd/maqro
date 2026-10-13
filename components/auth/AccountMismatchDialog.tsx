"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslations } from "next-intl";

export type AccountMismatchDialogProps = {
  open: boolean;
  /** Unsynced changes that were discarded; `0` means "unknown, but not
   *  verified synced". */
  count: number;
  /** The only way out: every close (the button, Escape) lands here, once. */
  onAcknowledge: () => void;
};

/** Tells the user that the MFA passkey step-up resolved to a different
 *  account, so they were signed out and this device's unsynced changes were
 *  discarded.
 *
 *  Acknowledge-only by design. The original account can't sync (its session
 *  is gone, and the replacement session belongs to someone else), and local
 *  data carries no owner: whoever signs in next adopts it, most likely the
 *  account whose passkey was just used. So the data is wiped before this
 *  dialog opens, and there is nothing to cancel. */
export function AccountMismatchDialog({
  open,
  count,
  onAcknowledge,
}: AccountMismatchDialogProps) {
  const t = useTranslations("signOutGuard.accountMismatch");
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // The action button closes the dialog too, so it lands here as well.
        if (!next) onAcknowledge();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("body")} {t("discarded", { count })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>{t("acknowledge")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
