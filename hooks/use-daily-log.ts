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
 * previous account. It is invalidated and reloaded from the store (wiped on
 * sign-out), and a load is never written back — only a user edit is —
 * otherwise the next account to sign in on this device would upload it as
 * its own. A guest → signed-in transition keeps
 * the day: guest data is adopted by the account by design. */
export function useDailyLog(date: string, defaultMeals: Meal[]): DailyLogState {
  const [meals, setMealsState] = useState<Meal[]>(defaultMeals);
  // The identity epoch follows whose local data this is (`localUserId`), so
  // an offline open with an expired session (offline-unverified) keeps the
  // account's day. Server calls need a real session (`user`).
  const { user, localUserId: userId } = useUser();
  const isSignedIn = user !== null;
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
  // "Edited since the last load or write": the auto-save only ever
  // persists a real user edit. Set by `setMeals` (and so `commitToDay`'s
  // in-memory path); cleared whenever a load replaces the in-memory day
  // and when the debounced write fires.
  //
  // A hydration is never an edit. Saving on one re-stamps `localUpdatedAt`
  // and turns a clean, synced row dirty, which (a) on a fresh session
  // (incognito, freshly cleared IDB) would push the synthetic
  // `defaultMeals` and clobber the user's real server-side meals, (b) re-
  // pushes every pulled peer change, and (c) on a direct account switch
  // (A → B without a wipe) would re-persist A's day as a dirty row that
  // B's first sync uploads into B's account.
  const editedSinceLoad = useRef(false);
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
    let cancelled = false;
    getDailyLog(date)
      .then((log) => {
        if (cancelled) return;
        const next = log?.meals ?? defaultMeals;
        // Keep the existing reference when nothing changed (our own save
        // echo), so the save effect's `meals` dep doesn't re-fire.
        setMealsState((prev) => (sameMeals(prev, next) ? prev : next));
        editedSinceLoad.current = false;
        setLoadedFor(`${epoch}|${date}`);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setMealsState(defaultMeals);
        editedSinceLoad.current = false;
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
    if (!editedSinceLoad.current) return;
    const t = window.setTimeout(() => {
      // A load that resolved to identical meals keeps the `meals` reference,
      // so this timer survives it; the load still superseded the edit.
      if (!editedSinceLoad.current) return;
      editedSinceLoad.current = false;
      saveDailyLog(date, meals).then(reportStorageOk).catch(reportStorageError);
      // Offer the day's foods for background micronutrient enrichment.
      // Fire-and-forget + Pro-gated server-side. Skip it entirely without a
      // session (signed out or offline-unverified) — the route is auth-only
      // and would just 401.
      if (latest.current.isSignedIn) enqueueMicronutrientEnrichment(meals);
    }, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [meals, date, isHydrated]);

  // Public setter — bumps the sync-pending counter so the topbar pill
  // can signal "you have local changes", and marks the day edited so the
  // auto-save persists it. Internal hydration uses setMealsState directly:
  // it is neither a pending change nor an edit.
  const setMeals = useCallback((next: Meal[]) => {
    editedSinceLoad.current = true;
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
