"use client";

import { useEffect, useState } from "react";

/** Tiny pub/sub for "a synced table just received fresh data from
 *  another device (or our own pull)". Components / hooks that read
 *  IDB-backed data subscribe here so they re-fetch the moment a
 *  Realtime event arrives, rather than waiting for the next manual
 *  refresh or sign-out / sign-in cycle.
 *
 *  Mirrors [lib/profile-bus.ts](../profile-bus.ts) in shape, but
 *  *also* maintains a per-table version counter. This is the load-
 *  bearing difference: it closes a race that bit us in fresh-window
 *  sign-ins where the initial sync's pull fired `notifyDataChanged`
 *  before `useDataRev`'s subscribe effect had run — the notification
 *  was delivered to zero subscribers, the hook never re-hydrated, and
 *  the next debounced auto-save uploaded synthetic defaults over the
 *  server's real data. With the version counter, `useDataRev` reads
 *  the current version on mount and on subscribe, so a notification
 *  that fired between render and subscribe still bumps the consumer. */

export type SyncedTable =
  | "profile"
  | "dailyLogs"
  | "weightHistory"
  | "bodyMeasurements"
  | "customFoods"
  | "mealTemplates"
  | "recipes"
  | "pantryItems"
  | "pantryNotifications"
  | "favoriteStores"
  | "shoppingListMeta"
  | "micronutrientProfiles";

const subscribers: Record<SyncedTable, Set<() => void>> = {
  profile: new Set(),
  dailyLogs: new Set(),
  weightHistory: new Set(),
  bodyMeasurements: new Set(),
  customFoods: new Set(),
  mealTemplates: new Set(),
  recipes: new Set(),
  pantryItems: new Set(),
  pantryNotifications: new Set(),
  favoriteStores: new Set(),
  shoppingListMeta: new Set(),
  micronutrientProfiles: new Set(),
};

/** Monotonic per-table version. Incremented by every notify; read by
 *  `useDataRev` on mount and on every notification so a callback that
 *  registered *after* the notify still sees the bump. */
const versions: Record<SyncedTable, number> = {
  profile: 0,
  dailyLogs: 0,
  weightHistory: 0,
  bodyMeasurements: 0,
  customFoods: 0,
  mealTemplates: 0,
  recipes: 0,
  pantryItems: 0,
  pantryNotifications: 0,
  favoriteStores: 0,
  shoppingListMeta: 0,
  micronutrientProfiles: 0,
};

/** Fire all subscribers registered for `table` and bump the persistent
 *  version. Errors in one subscriber don't block the rest. */
export function notifyDataChanged(table: SyncedTable): void {
  versions[table]++;
  for (const cb of subscribers[table]) {
    try {
      cb();
    } catch {
      // Swallow — bus is best-effort. A listener throwing means a
      // bug in that listener, not in the bus.
    }
  }
}

/** Read the current version for `table`. Used by `useDataRev` to
 *  recover from notifications that fired before subscribe. */
export function getDataVersion(table: SyncedTable): number {
  return versions[table];
}

/** Subscribe a callback to changes on `table`. Returns an unsubscribe
 *  function the caller invokes on cleanup (typically in a React
 *  `useEffect` return). */
export function subscribeDataChanged(
  table: SyncedTable,
  cb: () => void,
): () => void {
  subscribers[table].add(cb);
  return () => {
    subscribers[table].delete(cb);
  };
}

/** React hook: returns the persistent version for `table`, which the
 *  notify path increments. Including it in an effect's dep array makes
 *  the effect re-run on every realtime arrival, triggering the IDB
 *  re-read your component already does on mount.
 *
 *  Reads the current version on first render (closing the
 *  notify-before-subscribe race) AND inside the subscribe effect (so
 *  a notification that fired between the two also bumps).
 *
 *  Same pattern as the manual `customFoodsRev` / `templateRev`
 *  counters in [macro-calculator.tsx] — this just hooks it to the
 *  realtime + sync-pull bus so components don't have to thread the
 *  counter through props. */
export function useDataRev(table: SyncedTable): number {
  const [rev, setRev] = useState<number>(() => getDataVersion(table));
  useEffect(() => {
    const unsub = subscribeDataChanged(table, () => {
      setRev(getDataVersion(table));
    });
    // Catch a notification that fired in the window between this
    // component's first render and the subscribe effect actually
    // attaching (effects are scheduled async after commit, so there's
    // a real gap during which an external `notifyDataChanged` can be
    // delivered to zero subscribers). Wrapping in `queueMicrotask`
    // defers the setState past the current render commit and
    // satisfies `react-hooks/set-state-in-effect`.
    queueMicrotask(() => {
      setRev(getDataVersion(table));
    });
    return unsub;
  }, [table]);
  return rev;
}

/** Reset all subscribers + versions. Used by tests; not part of the
 *  public surface. */
export function __resetDataBusForTests(): void {
  for (const k of Object.keys(subscribers) as SyncedTable[]) {
    subscribers[k].clear();
    versions[k] = 0;
  }
}
