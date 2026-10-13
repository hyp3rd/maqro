"use client";

import { useSyncExternalStore } from "react";

export type SyncStatus =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "synced"; at: number }
  | { state: "error"; message: string }
  /** A push was rejected because the server's `updated_at` had moved
   *  on since our last pull — another device edited the same row(s)
   *  first. The local rows stay dirty (no sync overwrites them); the UI
   *  surfaces this so the user can keep this device's version or
   *  discard it in favour of the other device's. */
  | { state: "conflict"; count: number };

/** Combined view: the lifecycle state plus a "writes since last successful
 * sync" counter. Pending is independent of state — a user can have pending
 * writes while the engine is idle, synced, or errored.
 *
 * `pendingSinceAttempt` counts only the writes made since the latest sync
 * attempt STARTED — the ones no sync has tried to push yet. Automatic
 * triggers key off it so a sync that ended in a conflict or error isn't
 * re-fired in a loop when nothing new was written. */
export type SyncSnapshot = {
  status: SyncStatus;
  pending: number;
  pendingSinceAttempt: number;
};

const INITIAL: SyncSnapshot = {
  status: { state: "idle" },
  pending: 0,
  pendingSinceAttempt: 0,
};
const SERVER_SNAPSHOT: SyncSnapshot = INITIAL;

let snapshot: SyncSnapshot = INITIAL;
const subscribers = new Set<() => void>();

function setSnapshot(next: SyncSnapshot) {
  snapshot = next;
  for (const s of subscribers) s();
}

export function setSyncing(): void {
  setSnapshot({
    status: { state: "syncing" },
    pending: snapshot.pending,
    pendingSinceAttempt: 0,
  });
}

/** Marks the sync as successful: the lifecycle moves to `synced` and every
 * write the sync could have seen is reconciled. Writes that landed WHILE it
 * ran may not have been pushed (the engine compare-and-sets them dirty), so
 * they stay pending — otherwise no follow-up sync would be scheduled. */
export function setSynced(): void {
  setSnapshot({
    status: { state: "synced", at: Date.now() },
    pending: snapshot.pendingSinceAttempt,
    pendingSinceAttempt: snapshot.pendingSinceAttempt,
  });
}

/** Marks a sync that completed *successfully at the protocol level*
 *  but had one or more push rejections (peer device beat us to the
 *  punch). The pending counter is preserved — those rows are still
 *  dirty and need a retry. */
export function setSyncConflict(count: number): void {
  setSnapshot({ ...snapshot, status: { state: "conflict", count } });
}

export function setSyncError(err: unknown): void {
  // Defensive: even though sync paths wrap PostgrestError in proper Error
  // instances (see lib/sync/index.ts → asError), this handler still gets
  // called from other code paths. Pull the `.message` off plain objects
  // too so the pill tooltip never falls back to a generic "Sync failed".
  let message = "Sync failed";
  if (err instanceof Error) {
    message = err.message;
  } else if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    message = (err as { message: string }).message;
  }
  setSnapshot({ ...snapshot, status: { state: "error", message } });
}

/** Call after a user-facing IDB write completes. Marks the local store as
 * ahead of the server until the next successful sync. The sync engine's
 * own writes (pull-from-server) MUST NOT call this — those writes are
 * reconciliations, not new pending changes. */
export function bumpPending(): void {
  setSnapshot({
    ...snapshot,
    pending: snapshot.pending + 1,
    pendingSinceAttempt: snapshot.pendingSinceAttempt + 1,
  });
}

export function getSyncStatus(): SyncStatus {
  return snapshot.status;
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

export function __resetSyncStatusForTests(): void {
  snapshot = INITIAL;
  for (const s of subscribers) s();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

/** Returns the lifecycle status only. Kept for callers that don't care
 * about pending changes (the sync engine's concurrent-run guard). */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.status,
    () => SERVER_SNAPSHOT.status,
  );
}

/** Full snapshot — status plus pending counter. Used by the pill. */
export function useSyncSnapshot(): SyncSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}
