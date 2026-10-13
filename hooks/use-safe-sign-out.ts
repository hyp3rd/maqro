"use client";

import type { UnsyncedChangesDialogProps } from "@/components/auth/UnsyncedChangesDialog";
import { signOutRisk } from "@/lib/auth/sign-out-guard";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { getSyncSnapshot } from "@/lib/sync-status";
import { useRef, useState } from "react";

export type SafeSignOut = {
  /** Sync first, then sign out — or, if changes would still be lost,
   *  open the confirmation dialog instead. */
  requestSignOut: () => Promise<void>;
  /** True while the pre-sign-out sync or the sign-out itself runs. */
  busy: boolean;
  /** Spread onto `<UnsyncedChangesDialog />`. */
  dialog: UnsyncedChangesDialogProps;
};

/** Sign-out that never silently discards local changes.
 *
 *  Signing out wipes IndexedDB (`signOutAndClearLocal`), and in the default
 *  local-first sync mode edits only reach the server when the user saves or
 *  on the next page load — so a plain sign-out would delete them. This hook
 *  runs a sync first; if anything is still unsynced afterwards (offline,
 *  server error, conflicts, a sync already in flight) it asks the user, via
 *  `UnsyncedChangesDialog`, before calling `signOut`.
 *
 *  `signOut` is the caller's teardown (device unregister, the wipe + auth
 *  sign-out, the hard navigation that drops every in-memory copy of the
 *  previous user's data). It runs at most once per request. */
export function useSafeSignOut(signOut: () => Promise<void>): SafeSignOut {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [atRiskCount, setAtRiskCount] = useState<number | null>(null);

  async function runExclusive(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function requestSignOut() {
    await runExclusive(async () => {
      const supabase = getSupabaseBrowser();
      // The local session is enough to address the sync; RLS validates the
      // JWT server-side on every request anyway.
      const session = supabase
        ? (await supabase.auth.getSession()).data.session
        : null;
      if (supabase && session) {
        // Loaded on demand: the marketing header mounts this hook too, and
        // the sync engine has no business in the landing-page bundle.
        const { triggerSync } = await import("@/lib/sync");
        try {
          await triggerSync(supabase, session.user.id);
        } catch {
          // Not swallowed: triggerSync records the failure in sync-status
          // (setSyncError) before rethrowing, and signOutRisk below reads
          // that state to ask before anything is wiped.
        }
      }
      const risk = signOutRisk(getSyncSnapshot());
      if (risk.atRisk) {
        setAtRiskCount(risk.count);
        return;
      }
      await signOut();
    });
  }

  return {
    requestSignOut,
    busy,
    dialog: {
      open: atRiskCount !== null,
      count: atRiskCount ?? 0,
      reason: "sign-out",
      busy,
      onCancel: () => setAtRiskCount(null),
      onConfirm: () => {
        void runExclusive(async () => {
          await signOut();
          setAtRiskCount(null);
        });
      },
    },
  };
}
