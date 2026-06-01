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
import { useUser } from "@/hooks/use-user";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { discardPendingChanges, triggerSync } from "@/lib/sync";
import { useSyncSnapshot } from "@/lib/sync-status";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { AlertTriangle, Check, Cloud, Loader2, Trash2 } from "lucide-react";

/** Sync indicator + manual trigger shown in the topbar. Only renders when
 * a user is signed in — when signed out the sync engine isn't running so
 * there's nothing useful to report. Clicking the pill re-runs the sync;
 * while a sync is in flight the button is disabled and `triggerSync`
 * no-ops.
 *
 * Lifecycle states (idle / syncing / synced / error / conflict) layered
 * with a pending-writes indicator that shows whenever local IDB has
 * changes the server hasn't seen yet. Pending and the lifecycle state
 * are independent: a user can have pending writes while the engine is
 * idle, synced, or errored — they all surface the "Pending" label.
 *
 * When pending > 0 (or in the conflict state) a small companion
 * "Discard" button is shown next to the pill — for users who want to
 * throw away unsaved local edits and accept the server's state. */
export function SyncStatusPill() {
  const { user } = useUser();
  const { status, pending } = useSyncSnapshot();
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  if (!user) return null;

  function onClick() {
    if (!user) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    void triggerSync(supabase, user.id);
  }

  async function onConfirmDiscard() {
    setDiscardConfirmOpen(false);
    if (!user) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    // Errors are surfaced via sync-status; nothing to do with the
    // promise here.
    void discardPendingChanges(supabase, user.id);
  }

  const styles =
    "flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[11px] tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:hover:bg-transparent sm:h-7 sm:py-1";
  const syncing = status.state === "syncing";
  const hasPending = pending > 0;

  // While syncing, the spinner is canonical — don't compete with a pending
  // label even if writes raced in mid-sync (they'll surface next time the
  // pill goes idle/synced/errored).
  if (syncing) {
    return (
      <button
        type="button"
        disabled
        className={cn(styles, "text-muted-foreground")}
        title="Sync in progress"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Syncing…
      </button>
    );
  }

  // Conflict wins over "Pending" — the user *needs* to see that one or
  // more writes were rejected by a peer device's prior edit, otherwise
  // they'd just see "Pending" and assume the sync hasn't run yet. The
  // dirty rows that triggered the conflict are still in pending; the
  // retry will pull fresh + re-push them.
  if (status.state === "conflict") {
    const n = status.count;
    return (
      <>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onClick}
            className={cn(styles, "text-amber-700 dark:text-amber-400")}
            title={`${n} change${n === 1 ? "" : "s"} from this device weren't saved — another device edited the same row${n === 1 ? "" : "s"} first. Click to retry.`}
          >
            <AlertTriangle className="h-3 w-3" />
            Conflict ({n})
          </button>
          <DiscardButton onClick={() => setDiscardConfirmOpen(true)} />
        </div>
        <DiscardConfirmDialog
          open={discardConfirmOpen}
          onOpenChange={setDiscardConfirmOpen}
          onConfirm={onConfirmDiscard}
          count={pending}
          context="conflict"
        />
      </>
    );
  }

  if (hasPending) {
    const titleSuffix =
      status.state === "synced"
        ? ` (last synced ${new Date(status.at).toLocaleString()})`
        : status.state === "error"
          ? ` (sync error: ${status.message})`
          : "";
    return (
      <>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onClick}
            className={cn(styles, "text-foreground")}
            title={`${pending} unsynced change${pending === 1 ? "" : "s"} on this device${titleSuffix} — click to sync now`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-amber-500"
              aria-hidden
            />
            Pending
          </button>
          <DiscardButton onClick={() => setDiscardConfirmOpen(true)} />
        </div>
        <DiscardConfirmDialog
          open={discardConfirmOpen}
          onOpenChange={setDiscardConfirmOpen}
          onConfirm={onConfirmDiscard}
          count={pending}
          context="pending"
        />
      </>
    );
  }

  switch (status.state) {
    case "idle":
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(styles, "text-muted-foreground")}
          title="Sync now"
        >
          <Cloud className="h-3 w-3" />
          Ready
        </button>
      );
    case "synced":
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(styles, "text-muted-foreground")}
          title={`Last synced ${new Date(status.at).toLocaleString()} — click to sync again`}
        >
          <Check className="h-3 w-3" />
          Synced
        </button>
      );
    case "error":
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(styles, "text-amber-700 dark:text-amber-400")}
          title={`${status.message} — click to retry`}
        >
          <AlertTriangle className="h-3 w-3" />
          Sync error
        </button>
      );
  }
}

/** Small trash-icon button rendered next to the pending / conflict pill.
 *  Triggers the confirm dialog rather than discarding immediately —
 *  this throws away user data and one-click would be too easy to
 *  mis-fire on touch screens. */
function DiscardButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:w-7"
      title="Discard local changes"
      aria-label="Discard local changes"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

function DiscardConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  count,
  context,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
  count: number;
  context: "pending" | "conflict";
}) {
  const noun = count === 1 ? "change" : "changes";
  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Discard {count} local {noun}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {context === "conflict"
              ? `These ${noun} couldn't be saved because another device edited the same data first. Discarding accepts the other device's version and throws away your local edit${count === 1 ? "" : "s"}.`
              : `Throws away every unsaved edit on this device and re-pulls the latest data from the server. The other devices are unaffected. This can't be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Discard {noun}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
