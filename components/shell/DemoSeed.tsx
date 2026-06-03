"use client";

import {
  getProfile,
  saveDailyLog,
  saveDemoProfile,
  saveWeightEntry,
  setWaterTotal,
  todayKey,
} from "@/lib/db";
import {
  DEMO_FLAG_KEY,
  getDemoMealLogs,
  getDemoProfile,
  getDemoWaterLogs,
  getDemoWeightHistory,
} from "@/lib/demo-data";
import { notifyProfileChanged } from "@/lib/profile-bus";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useEffect } from "react";
import { toast } from "sonner";

/** Detects `?demo=1` in the URL and, if the local IndexedDB is
 *  empty, seeds it with the sample dataset from
 *  [lib/demo-data.ts](../../lib/demo-data.ts). Otherwise it skips
 *  silently with a one-liner toast so the user's real data is
 *  never overwritten.
 *
 *  Strips the `demo` query param from the URL after seeding so
 *  refreshes don't re-trigger. Sets a localStorage flag so future
 *  features (a "this is sample data" banner, a "clear demo data"
 *  button in Settings) can detect demo mode without inspecting
 *  IndexedDB.
 *
 *  Mounted in [AppShell](./AppShell.tsx) — fires once per app
 *  mount, no-op on every load except first-with-?demo=1. */
export function DemoSeed() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") !== "1") return;

    let cancelled = false;
    (async () => {
      try {
        // Hard gate: if a user is signed in, never seed demo data —
        // even if their IDB is briefly empty (sync hasn't run yet).
        // Seeding here would race with `SyncManager`'s pull and could
        // push demo rows up to the user's real Supabase account. The
        // `existingProfile` check below is a softer signal (covers
        // guest-mode users who already used the app); the auth check
        // is the authoritative one for signed-in accounts.
        const supabase = getSupabaseBrowser();
        if (supabase) {
          const { data } = await supabase.auth.getUser();
          if (data.user) {
            if (cancelled) return;
            toast.info("You're signed in — sample data isn't loaded.");
            stripDemoParam();
            return;
          }
        }

        const existingProfile = await getProfile();
        // Skip if real data exists — don't clobber a user who
        // arrived at /app?demo=1 by accident. The toast tells
        // them why nothing changed.
        if (existingProfile !== null) {
          if (cancelled) return;
          toast.info("You already have data — demo skipped.");
          stripDemoParam();
          return;
        }

        const today = todayKey();
        // `saveDemoProfile` (not `saveProfile`) sets an `_demoSeeded`
        // flag on the IDB profile row — a durable signal so a private
        // window or quota-exceeded localStorage write doesn't drop the
        // `DEMO_FLAG_KEY` and let demo data leak into the signed-in
        // user's account on the next sync.
        await saveDemoProfile(getDemoProfile());
        for (const log of getDemoMealLogs(today)) {
          await saveDailyLog(log.date, log.meals);
        }
        for (const w of getDemoWeightHistory(today)) {
          await saveWeightEntry(w.date, w.kg);
        }
        for (const wi of getDemoWaterLogs(today)) {
          await setWaterTotal(wi.date, wi.ml);
        }

        if (cancelled) return;
        try {
          window.localStorage.setItem(DEMO_FLAG_KEY, "1");
        } catch {
          // Storage disabled — fine; the flag is informational
          // for future features, not load-bearing.
        }
        // Tell the profile-driven hooks (sidebar UserMenu,
        // useProfile) to re-fetch so the UI populates without
        // a manual refresh.
        notifyProfileChanged();
        toast.success(
          "Sample data loaded — explore freely, then start over from Settings.",
        );
        stripDemoParam();
      } catch (err) {
        console.error("[demo-seed] failed:", err);
        if (!cancelled) {
          toast.error("Couldn't load sample data. Try refreshing.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

/** Remove `?demo=1` from the URL bar without triggering a
 *  navigation. Keeps refreshes from re-firing the seed effect. */
function stripDemoParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("demo");
  window.history.replaceState({}, "", url.toString());
}
