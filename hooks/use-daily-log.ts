"use client";

import type { Meal } from "@/components/macro/types";
import { useUser } from "@/hooks/use-user";
import { sameMeals } from "@/lib/daily-log-cas";
import { getDailyLog, saveDailyLog } from "@/lib/db";
import { enqueueMicronutrientEnrichment } from "@/lib/micronutrients/enqueue";
import { reportStorageError, reportStorageOk } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const WRITE_DEBOUNCE_MS = 500;

/** The day (and signed-in identity) a deferred edit was started for. Capture
 *  `day` when the user acts, hand it back to `commitToDay` once the async
 *  work resolves. `epoch` changes whenever a signed-in user goes away (sign-
 *  out or account switch), so an edit started by the previous account can
 *  never land in the next one's store. */
export type DayTarget = { readonly date: string; readonly epoch: number };

export type DailyLogState = {
  date: string;
  meals: Meal[];
  setMeals: (next: Meal[]) => void;
  isHydrated: boolean;
  /** The currently displayed day, for deferred edits (see `DayTarget`). */
  day: DayTarget;
  /** Apply a deferred edit to the day it was started for, against that
   *  day's LATEST meals: in memory while the day is still displayed and
   *  hydrated (keeps edits the write debounce hasn't flushed), otherwise
   *  straight to its IndexedDB row. `update` returns `null` to reject the
   *  latest state (e.g. it changed since the edit was computed). Resolves
   *  `true` when the edit landed, `false` when it was rejected or the
   *  signed-in identity changed. IndexedDB errors reject. */
  commitToDay: (
    target: DayTarget,
    update: (latest: Meal[]) => Meal[] | null,
  ) => Promise<boolean>;
};

/** Persists the meal log for a specific date in IndexedDB. The caller
 * chooses the date — typically today via `useToday`, but the date
 * navigator pins a historical day when the user navigates. When the
 * date changes, the hook reloads the new day's log (or seeds empty
 * meals) and skips writes until the load resolves, so we never write
 * yesterday's meals to today's key during the transition.
 *
 * The same applies to identity: when a signed-in user goes away (sign-out
 * wipes IndexedDB, or an account switch), the in-memory day belongs to the
 * previous account. It is invalidated and reloaded from the (wiped) store,
 * and never written back — otherwise the next account to sign in on this
 * device would upload it as its own. A guest → signed-in transition keeps
 * the day: guest data is adopted by the account by design. */
export function useDailyLog(date: string, defaultMeals: Meal[]): DailyLogState {
  const [meals, setMealsState] = useState<Meal[]>(defaultMeals);
  const userId = useUser().user?.id ?? null;
  const isSignedIn = userId !== null;
  // Identity epoch — see the hook doc. Adjusted during render (React's
  // "storing information from previous renders" pattern) so the very render
  // that sees the user leave already reports the day as not hydrated, which
  // stops the save effect before it can fire for the old account.
  const [identity, setIdentity] = useState({ userId, epoch: 0 });
  if (identity.userId !== userId) {
    setIdentity({
      userId,
      epoch: identity.userId === null ? identity.epoch : identity.epoch + 1,
    });
  }
  const epoch = identity.epoch;
  // `loadedFor` is the epoch+date the current `meals` state corresponds to.
  // Hydration is derived from it matching — this lets us avoid the
  // `react-hooks/set-state-in-effect` rule, which would fire if we
  // synchronously reset isHydrated to false at the top of the effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const hydrationKey = `${epoch}|${date}`;
  const isHydrated = loadedFor === hydrationKey && date !== "";
  // Re-runs the load effect when a peer device's daily-log change
  // arrives via realtime. The hook reads whatever date is currently
  // active; if the peer changed a *different* day's log, the IDB
  // re-read for the current day returns the same data and React
  // diffs it as a no-op.
  const dailyLogsRev = useDataRev("dailyLogs");
  // Gate the auto-save on a *real* user edit. Without it, a fresh
  // session (incognito window, freshly cleared IDB) would auto-save
  // the synthetic `defaultMeals` to IDB before the initial sync runs,
  // and the first push would upload an empty meals array — clobbering
  // the user's actual logged meals on the server. Set true by the
  // load effect when an actual saved row was loaded, and by `setMeals`
  // when the user produces real data. Reset when the identity epoch
  // changes, so the previous account's edits never unlock a write.
  const hasRealLocalData = useRef(false);
  const loadedEpoch = useRef(epoch);
  // Latest values for the deferred paths (the debounced save's enrichment
  // call, `commitToDay`), which run after the render that scheduled them.
  // Synced in an effect because writing refs during render is disallowed.
  const latest = useRef({
    date,
    epoch,
    meals,
    isHydrated,
    isSignedIn,
    defaultMeals,
  });
  useEffect(() => {
    latest.current = {
      date,
      epoch,
      meals,
      isHydrated,
      isSignedIn,
      defaultMeals,
    };
  }, [date, epoch, meals, isHydrated, isSignedIn, defaultMeals]);

  useEffect(() => {
    if (date === "") return; // SSR snapshot; skip until hydrate.
    if (loadedEpoch.current !== epoch) {
      loadedEpoch.current = epoch;
      hasRealLocalData.current = false;
    }
    let cancelled = false;
    getDailyLog(date)
      .then((log) => {
        if (cancelled) return;
        const next = log?.meals ?? defaultMeals;
        // Keep the existing reference when nothing changed (our own save
        // echo), so the save effect's `meals` dep doesn't re-fire.
        setMealsState((prev) => (sameMeals(prev, next) ? prev : next));
        if (log) hasRealLocalData.current = true;
        setLoadedFor(`${epoch}|${date}`);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setMealsState(defaultMeals);
        setLoadedFor(`${epoch}|${date}`);
      });
    return () => {
      cancelled = true;
    };
  }, [date, epoch, defaultMeals, dailyLogsRev]);

  // Deliberately NOT keyed on auth state: an auth transition is not an edit
  // and must never schedule a write (see the hook doc for the sign-out case).
  useEffect(() => {
    if (!isHydrated) return;
    if (!hasRealLocalData.current) return;
    const t = window.setTimeout(() => {
      saveDailyLog(date, meals).then(reportStorageOk).catch(reportStorageError);
      // Offer the day's foods for background micronutrient enrichment.
      // Fire-and-forget + Pro-gated server-side. Skip it entirely when
      // signed out — the route is auth-only and would just 401.
      if (latest.current.isSignedIn) enqueueMicronutrientEnrichment(meals);
    }, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [meals, date, isHydrated]);

  // Public setter — bumps the sync-pending counter so the topbar pill
  // can signal "you have local changes." Also flips `hasRealLocalData`
  // so the auto-save effect is unblocked even on a fresh session where
  // nothing was loaded from IDB. Internal hydration uses setMealsState
  // directly to avoid spurious pending signals.
  const setMeals = useCallback((next: Meal[]) => {
    hasRealLocalData.current = true;
    bumpPending();
    setMealsState(next);
  }, []);

  const day = useMemo<DayTarget>(() => ({ date, epoch }), [date, epoch]);

  const commitToDay = useCallback(
    async (
      target: DayTarget,
      update: (latestMeals: Meal[]) => Meal[] | null,
    ): Promise<boolean> => {
      const now = latest.current;
      if (target.epoch !== now.epoch) return false;
      if (target.date === now.date && now.isHydrated) {
        const next = update(now.meals);
        if (next === null) return false;
        setMeals(next);
        return true;
      }
      const log = await getDailyLog(target.date);
      // The identity may have changed while the row was being read.
      if (target.epoch !== latest.current.epoch) return false;
      const next = update(log?.meals ?? now.defaultMeals);
      if (next === null) return false;
      // saveDailyLog's data-bus notify re-hydrates this hook if the user
      // switches back to `target.date`.
      await saveDailyLog(target.date, next);
      bumpPending();
      return true;
    },
    [setMeals],
  );

  return { date, meals, setMeals, isHydrated, day, commitToDay };
}
