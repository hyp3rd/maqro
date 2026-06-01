"use client";

import { useSyncExternalStore } from "react";

/** Snapshot of the persistence layer's health. `ok=false` means at least
 * one read or write failed since startup; the UI surfaces a banner. The
 * `acknowledged` flag lets users dismiss the banner without changing the
 * underlying state, so we don't re-show it on every keystroke after they
 * close it. */
export type StorageStatus = { ok: boolean; acknowledged: boolean };

const INITIAL: StorageStatus = { ok: true, acknowledged: false };
const SERVER_SNAPSHOT: StorageStatus = INITIAL;

let state: StorageStatus = INITIAL;
const subscribers = new Set<() => void>();

function emit() {
  for (const s of subscribers) s();
}

function setState(next: StorageStatus) {
  if (state.ok === next.ok && state.acknowledged === next.acknowledged) {
    // Identity-stable no-op so useSyncExternalStore can skip the render.
    return;
  }
  state = next;
  emit();
}

/** Call when a persistence read or write throws. First failure flips the
 * banner on; subsequent failures are coalesced. */
export function reportStorageError(err: unknown): void {
  if (typeof console !== "undefined") {
    // Keep the original error on the console so debugging isn't blind.
    console.warn("[macro] Persistence error:", err);
  }
  if (!state.ok) return;
  setState({ ok: false, acknowledged: false });
}

/** Call after a successful write. If we were in an error state, clear it
 * — storage is reachable again. */
export function reportStorageOk(): void {
  if (state.ok) return;
  setState(INITIAL);
}

/** Dismiss the banner without changing the underlying health. The next
 * call to `reportStorageError` will reset `acknowledged`. */
export function ackStorageError(): void {
  if (state.ok || state.acknowledged) return;
  setState({ ok: false, acknowledged: true });
}

/** Synchronous snapshot for code that can't use the React hook (tests,
 * non-React modules). */
export function getStorageStatus(): StorageStatus {
  return state;
}

/** Reset to initial state. Tests only — production code should not call. */
export function __resetStorageStatusForTests(): void {
  state = INITIAL;
  emit();
}

export function useStorageStatus(): StorageStatus {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    () => state,
    () => SERVER_SNAPSHOT,
  );
}
