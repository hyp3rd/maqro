"use client";

import { useSyncExternalStore } from "react";

export type SyncStatus =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "synced"; at: number }
  | { state: "error"; message: string }
  /** A push was rejected because the server's `updated_at` had moved
   *  on since our last pull — another device edited the same row(s)
   *  first. The local rows stay dirty; the UI surfaces this so the
   *  user can re-attempt the sync (which will pull fresh first). */
  | { state: "conflict"; count: number };

/** Combined view: the lifecycle state plus a "writes since last successful
 * sync" counter. Pending is independent of state — a user can have pending
 * writes while the engine is idle, synced, or errored. */
export type SyncSnapshot = { status: SyncStatus; pending: number };

const INITIAL: SyncSnapshot = { status: { state: "idle" }, pending: 0 };
const SERVER_SNAPSHOT: SyncSnapshot = INITIAL;

let snapshot: SyncSnapshot = INITIAL;
const subscribers = new Set<() => void>();

function setSnapshot(next: SyncSnapshot) {
  snapshot = next;
  for (const s of subscribers) s();
}

export function setSyncing(): void {
  setSnapshot({ status: { state: "syncing" }, pending: snapshot.pending });
}

/** Marks the sync as successful: the lifecycle moves to `synced` AND the
 * pending counter resets to zero. The two are tied — a successful sync is
 * exactly the moment the pending writes get reconciled with the server. */
export function setSynced(): void {
  setSnapshot({ status: { state: "synced", at: Date.now() }, pending: 0 });
}

/** Marks a sync that completed *successfully at the protocol level*
 *  but had one or more push rejections (peer device beat us to the
 *  punch). The pending counter is preserved — those rows are still
 *  dirty and need a retry. */
export function setSyncConflict(count: number): void {
  setSnapshot({
    status: { state: "conflict", count },
    pending: snapshot.pending,
  });
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
  setSnapshot({
    status: { state: "error", message },
    pending: snapshot.pending,
  });
}

/** Call after a user-facing IDB write completes. Marks the local store as
 * ahead of the server until the next successful sync. The sync engine's
 * own writes (pull-from-server) MUST NOT call this — those writes are
 * reconciliations, not new pending changes. */
export function bumpPending(): void {
  setSnapshot({ ...snapshot, pending: snapshot.pending + 1 });
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
