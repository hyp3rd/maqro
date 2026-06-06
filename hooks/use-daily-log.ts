"use client";

import type { Meal } from "@/components/macro/types";
import { useUser } from "@/hooks/use-user";
import { getDailyLog, saveDailyLog } from "@/lib/db";
import { enqueueMicronutrientEnrichment } from "@/lib/micronutrients/enqueue";
import { reportStorageError, reportStorageOk } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useRef, useState } from "react";

const WRITE_DEBOUNCE_MS = 500;

/** Cheap structural compare of two days' meals. Used to ignore our own
 *  data-bus echo: `saveDailyLog` now notifies `dailyLogs` so other consumers
 *  refresh on a local log, which re-runs this hook's load effect — but the
 *  IDB re-read returns the value we just wrote, so we keep the existing
 *  `meals` reference (no state churn, no save→notify→reload→save loop). A
 *  genuine peer change has different content and still applies. Meal arrays
 *  are one day's worth, so JSON serialization is negligible. */
function sameMeals(a: Meal[], b: Meal[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type DailyLogState = {
  date: string;
  meals: Meal[];
  setMeals: (next: Meal[]) => void;
  isHydrated: boolean;
};

/** Persists the meal log for a specific date in IndexedDB. The caller
 * chooses the date — typically today via `useToday`, but the date
 * navigator pins a historical day when the user navigates. When the
 * date changes, the hook reloads the new day's log (or seeds empty
 * meals) and skips writes until the load resolves, so we never write
 * yesterday's meals to today's key during the transition. */
export function useDailyLog(date: string, defaultMeals: Meal[]): DailyLogState {
  const [meals, setMealsState] = useState<Meal[]>(defaultMeals);
  // `loadedFor` is the date the current `meals` state corresponds to.
  // Hydration is derived from it being equal to `date` — this lets us
  // avoid the `react-hooks/set-state-in-effect` rule, which would fire if
  // we synchronously reset isHydrated to false at the top of the effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const isHydrated = loadedFor === date && date !== "";
  // Re-runs the load effect when a peer device's daily-log change
  // arrives via realtime. The hook reads whatever date is currently
  // active; if the peer changed a *different* day's log, the IDB
  // re-read for the current day returns the same data and React
  // diffs it as a no-op.
  const dailyLogsRev = useDataRev("dailyLogs");
  // Signed-in gate for the background enrichment call in the save effect —
  // the route is auth-only, so firing it as a guest just 401s.
  const isSignedIn = !!useUser().user;
  // Gate the auto-save on a *real* user edit. Without it, a fresh
  // session (incognito window, freshly cleared IDB) would auto-save
  // the synthetic `defaultMeals` to IDB before the initial sync runs,
  // and the first push would upload an empty meals array — clobbering
  // the user's actual logged meals on the server. Set true by the
  // load effect when an actual saved row was loaded, and by `setMeals`
  // when the user produces real data.
  const hasRealLocalData = useRef(false);

  useEffect(() => {
    if (date === "") return; // SSR snapshot; skip until hydrate.
    let cancelled = false;
    getDailyLog(date)
      .then((log) => {
        if (cancelled) return;
        const next = log?.meals ?? defaultMeals;
        // Keep the existing reference when nothing changed (our own save
        // echo), so the save effect's `meals` dep doesn't re-fire.
        setMealsState((prev) => (sameMeals(prev, next) ? prev : next));
        if (log) hasRealLocalData.current = true;
        setLoadedFor(date);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setMealsState(defaultMeals);
        setLoadedFor(date);
      });
    return () => {
      cancelled = true;
    };
  }, [date, defaultMeals, dailyLogsRev]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!hasRealLocalData.current) return;
    const t = window.setTimeout(() => {
      saveDailyLog(date, meals).then(reportStorageOk).catch(reportStorageError);
      // Offer the day's foods for background micronutrient enrichment.
      // Fire-and-forget + Pro-gated server-side. Skip it entirely when
      // signed out — the route is auth-only and would just 401.
      if (isSignedIn) enqueueMicronutrientEnrichment(meals);
    }, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [meals, date, isHydrated, isSignedIn]);

  // Public setter — bumps the sync-pending counter so the topbar pill
  // can signal "you have local changes." Also flips `hasRealLocalData`
  // so the auto-save effect is unblocked even on a fresh session where
  // nothing was loaded from IDB. Internal hydration uses setMealsState
  // directly to avoid spurious pending signals.
  function setMeals(next: Meal[]) {
    hasRealLocalData.current = true;
    bumpPending();
    setMealsState(next);
  }

  return { date, meals, setMeals, isHydrated };
}
