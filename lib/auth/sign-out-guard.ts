import type { SyncSnapshot } from "@/lib/sync-status";

/** What signing out (which wipes IndexedDB) would put at risk. */
export type SignOutRisk = {
  /** True unless the last sync verifiably landed every local change. */
  atRisk: boolean;
  /** Best known number of unsynced changes. `0` with `atRisk` means the
   *  count is unknown (e.g. the sync failed after a reload, when the
   *  in-memory counter starts from zero) — the UI must still warn. */
  count: number;
};

/** Decide whether signing out would discard local changes, from the shared
 *  sync-status snapshot (the same counter the "Save N" pill shows).
 *
 *  Only a completed, conflict-free sync with nothing written since proves the
 *  server holds everything: every dirty row is pushed by a successful run, a
 *  failed push throws (`error`), and a rejected push leaves the row dirty
 *  (`conflict`). Anything else — never synced this page load (`idle`), a run
 *  still in flight (`syncing`), a failure (offline, server error) or a
 *  conflict — is treated as at risk, even when the counter reads zero,
 *  because the counter is per-page-load and cannot see rows left dirty by an
 *  earlier session. */
export function signOutRisk(snapshot: SyncSnapshot): SignOutRisk {
  const { status, pending } = snapshot;
  if (status.state === "synced" && pending === 0) {
    return { atRisk: false, count: 0 };
  }
  const conflicts = status.state === "conflict" ? status.count : 0;
  return { atRisk: true, count: Math.max(pending, conflicts) };
}
