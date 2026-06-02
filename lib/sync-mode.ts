import { useSyncExternalStore } from "react";

/** How aggressively this device pushes local edits to the server:
 *   - `local-first` — stay local; the user saves manually (the
 *     historical default). A reminder nudges after a quiet spell.
 *   - `auto-save`   — push on an interval (minutes) while there are
 *     unsaved changes.
 *   - `remote-only` — push shortly after every change so the server is
 *     continuously current. */
export type SyncMode = "local-first" | "auto-save" | "remote-only";

export type SyncModePrefs = {
  mode: SyncMode;
  /** Minutes between pushes in `auto-save` mode. */
  intervalMinutes: number;
};

const MODE_KEY = "maqro:sync-mode";
const INTERVAL_KEY = "maqro:auto-save-interval";

export const DEFAULT_MODE: SyncMode = "local-first";
export const DEFAULT_INTERVAL_MIN = 5;
export const MIN_INTERVAL_MIN = 1;
export const MAX_INTERVAL_MIN = 30;

const SERVER_PREFS: SyncModePrefs = {
  mode: DEFAULT_MODE,
  intervalMinutes: DEFAULT_INTERVAL_MIN,
};

// Preferences are a per-DEVICE behaviour (not synced) — storing them in
// the synced profile would be a chicken-and-egg (a setting that controls
// syncing shouldn't depend on a sync to take effect). localStorage with
// a small pub/sub so Settings, the controller, and the pill all react.
const listeners = new Set<() => void>();

function clampInterval(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL_MIN;
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(n)));
}

function readMode(): SyncMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "local-first" || v === "auto-save" || v === "remote-only") {
      return v;
    }
  } catch {
    /* storage disabled */
  }
  return DEFAULT_MODE;
}

function readInterval(): number {
  try {
    const raw = localStorage.getItem(INTERVAL_KEY);
    if (raw != null) return clampInterval(Number.parseInt(raw, 10));
  } catch {
    /* storage disabled */
  }
  return DEFAULT_INTERVAL_MIN;
}

// Cached snapshot — `useSyncExternalStore` requires a stable reference
// between renders, so we only replace it when a value actually changes.
let snapshot: SyncModePrefs = SERVER_PREFS;
let initialized = false;

function recompute(): void {
  const mode = readMode();
  const intervalMinutes = readInterval();
  if (snapshot.mode !== mode || snapshot.intervalMinutes !== intervalMinutes) {
    snapshot = { mode, intervalMinutes };
  }
}

function getSnapshot(): SyncModePrefs {
  if (!initialized) {
    recompute();
    initialized = true;
  }
  return snapshot;
}

function getServerSnapshot(): SyncModePrefs {
  return SERVER_PREFS;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MODE_KEY || e.key === INTERVAL_KEY) {
      recompute();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function emit(): void {
  recompute();
  for (const l of listeners) l();
}

export function setSyncMode(mode: SyncMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage disabled */
  }
  emit();
}

export function setAutoSaveInterval(minutes: number): void {
  try {
    localStorage.setItem(INTERVAL_KEY, String(clampInterval(minutes)));
  } catch {
    /* storage disabled */
  }
  emit();
}

/** Reactive read of the current sync-mode preferences. */
export function useSyncMode(): SyncModePrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
