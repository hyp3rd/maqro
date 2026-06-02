"use client";

import { useUser } from "@/hooks/use-user";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { triggerSync } from "@/lib/sync";
import { useSyncMode } from "@/lib/sync-mode";
import { useSyncSnapshot } from "@/lib/sync-status";
import { useCallback, useEffect, useRef, useState } from "react";
import { SaveReminderDialog } from "./SaveReminderDialog";

const REMINDER_AFTER_MS = 5 * 60_000; // local-first nudge after a quiet spell
const REMOTE_DEBOUNCE_MS = 2_000; // remote-only push, after edits settle

/** Drives the per-device sync behaviour selected in Settings. Renders no
 *  chrome of its own except the local-first save reminder. Mounted once,
 *  beside SyncManager. */
export function SyncModeController() {
  const { user } = useUser();
  const { mode, intervalMinutes } = useSyncMode();
  const { status, pending } = useSyncSnapshot();
  const [reminderOpen, setReminderOpen] = useState(false);

  const userId = user?.id ?? null;
  const syncing = status.state === "syncing";

  // Latest values for the interval tick (which captures its closure once).
  // Updated in an effect — writing refs during render isn't allowed.
  const pendingRef = useRef(pending);
  const syncingRef = useRef(syncing);
  useEffect(() => {
    pendingRef.current = pending;
    syncingRef.current = syncing;
  }, [pending, syncing]);

  const doSync = useCallback(() => {
    const supabase = getSupabaseBrowser();
    if (!userId || !supabase) return;
    void triggerSync(supabase, userId);
  }, [userId]);

  // remote-only: push a short debounce after the latest change, so the
  // server stays continuously current without a request per keystroke.
  useEffect(() => {
    if (!userId || mode !== "remote-only" || pending <= 0 || syncing) return;
    const t = setTimeout(doSync, REMOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [userId, mode, pending, syncing, doSync]);

  // auto-save: a fixed interval that pushes whenever changes are pending.
  useEffect(() => {
    if (!userId || mode !== "auto-save") return;
    const ms = Math.min(30, Math.max(1, intervalMinutes)) * 60_000;
    const id = setInterval(() => {
      if (pendingRef.current > 0 && !syncingRef.current) doSync();
    }, ms);
    return () => clearInterval(id);
  }, [userId, mode, intervalMinutes, doSync]);

  // local-first: nudge to save after a quiet spell of unsaved changes.
  // The timer resets on each new change, so it fires ~5 min after the
  // *last* edit — not mid-typing. setState lives in the async timer
  // callback, not the effect body (avoids the sync-setState lint).
  useEffect(() => {
    if (!userId || mode !== "local-first" || pending <= 0) return;
    const t = setTimeout(() => setReminderOpen(true), REMINDER_AFTER_MS);
    return () => clearTimeout(t);
  }, [userId, mode, pending]);

  // Render the reminder only in local-first — switching modes (or signing
  // out) unmounts it, so it can't linger after the mode changes.
  if (mode !== "local-first" || !userId) return null;

  return (
    <SaveReminderDialog
      open={reminderOpen}
      onOpenChange={setReminderOpen}
      count={pending}
      saving={syncing}
      onSave={() => {
        doSync();
        setReminderOpen(false);
      }}
    />
  );
}
