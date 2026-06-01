"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";

export type NotificationPrefs = {
  dailyReminder: boolean;
  weeklyRecap: boolean;
  /** Browser push channel for the daily reminder. Distinct from
   *  `dailyReminder` so a user can have one enabled and the other
   *  off — phone push without inbox noise, or vice versa. */
  pushEnabled: boolean;
  /** Local hour-of-day (0-23) for the daily reminder. The hourly
   *  cron matches this against the user's local hour and only
   *  sends when they line up. */
  reminderHour: number;
  /** IANA timezone string (`Europe/Berlin`, `America/Los_Angeles`,
   *  …) used to compute "local hour". `null` falls back to the
   *  cron's UTC default to preserve historical behavior. */
  timezone: string | null;
};

export type NotificationPrefsState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "unconfigured" }
  | { status: "ok"; data: NotificationPrefs }
  | { status: "error"; message: string };

export type UseNotificationPrefsResult = {
  state: NotificationPrefsState;
  /** Optimistically toggle one or both flags. The local state flips
   *  immediately so the UI doesn't lag; on failure we revert and
   *  surface the error. */
  update: (patch: Partial<NotificationPrefs>) => Promise<void>;
};

/** Default reminder hour for new users — 18:00 local. Mirrors the
 *  historical UTC blast that ran before localization landed. */
const DEFAULT_REMINDER_HOUR = 18;

/** Best-effort guess at the user's IANA timezone, falling back to
 *  null if `Intl` can't tell us (older mobile browsers). Server
 *  treats null as UTC. */
function detectTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const DEFAULT_PREFS: NotificationPrefs = {
  dailyReminder: false,
  weeklyRecap: false,
  pushEnabled: false,
  reminderHour: DEFAULT_REMINDER_HOUR,
  timezone: null,
};

/** Read + write the caller's notification preferences. Direct
 *  Supabase calls (not via a dedicated API route) — the
 *  `notification_preferences_owner_all` RLS policy from migration
 *  0013 enforces the user-id scoping. Server-side cron reads use
 *  the service-role client and bypass RLS, but that's a different
 *  path. */
export function useNotificationPrefs(): UseNotificationPrefsResult {
  // Lazy initial state pulls Supabase env once per mount. Setting
  // "unconfigured" here avoids an `setState` inside the effect body
  // (which the react-hooks/set-state-in-effect rule rejects) and
  // also means the UI never flashes "loading" for unconfigured
  // builds — it goes straight to the unconfigured branch which
  // renders nothing.
  const [state, setState] = useState<NotificationPrefsState>(() => {
    if (typeof window === "undefined") return { status: "loading" };
    const supabase = getSupabaseBrowser();
    return supabase ? { status: "loading" } : { status: "unconfigured" };
  });

  // Initial fetch — only runs when Supabase is configured. The
  // unconfigured branch already short-circuited in the initial
  // state above.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setState({ status: "anon" });
        return;
      }
      const { data, error } = await supabase
        .from("notification_preferences")
        .select(
          "daily_reminder, weekly_recap, push_enabled, reminder_hour, timezone",
        )
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }
      setState({
        status: "ok",
        data: {
          dailyReminder:
            (data?.daily_reminder as boolean | undefined) ??
            DEFAULT_PREFS.dailyReminder,
          weeklyRecap:
            (data?.weekly_recap as boolean | undefined) ??
            DEFAULT_PREFS.weeklyRecap,
          pushEnabled:
            (data?.push_enabled as boolean | undefined) ??
            DEFAULT_PREFS.pushEnabled,
          reminderHour:
            (data?.reminder_hour as number | undefined) ??
            DEFAULT_REMINDER_HOUR,
          // If the row's timezone column is NULL (legacy / never
          // set), seed with the browser's best guess so the user
          // doesn't have to pick it manually. The next `update`
          // call persists whatever they have.
          timezone: (data?.timezone as string | undefined) ?? detectTimeZone(),
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      const supabase = getSupabaseBrowser();
      if (!supabase) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      if (state.status !== "ok") return;
      const previous = state.data;
      const next: NotificationPrefs = { ...previous, ...patch };

      // Optimistic update — the toggle flips before the network
      // round-trip lands. On failure we revert to `previous` so the
      // UI doesn't lie about what's stored server-side.
      setState({ status: "ok", data: next });

      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          {
            user_id: user.id,
            daily_reminder: next.dailyReminder,
            weekly_recap: next.weeklyRecap,
            push_enabled: next.pushEnabled,
            reminder_hour: next.reminderHour,
            timezone: next.timezone,
          },
          { onConflict: "user_id" },
        );
      if (error) {
        setState({ status: "ok", data: previous });
        // Surfacing through state.message would clobber the ok-branch
        // we just reverted to; log instead and let the user retry the
        // toggle.
        console.error("[notification-prefs] upsert failed:", error);
        return;
      }

      // First-opt-in welcome email. The endpoint is idempotent at
      // the data layer (`welcome_sent_at` server-side), but its
      // rate limiter throttles repeated POSTs and returns 429.
      // Firing on every toggle (the previous behaviour) was tripping
      // that limiter whenever a user flipped both Daily-reminder
      // and Weekly-recap on in the same session, generating console
      // noise even though the send had already happened.
      //
      // Gate the call on the off→on transition only: previous had
      // both flags off, the new state has at least one on. That
      // matches the "first opt-in" moment exactly. Toggling a
      // second flag on (or toggling off then on again within a
      // session) is a no-op for the welcome — the rate limiter
      // never sees it because we don't ask.
      const previouslyAnyEnabled =
        previous.dailyReminder || previous.weeklyRecap;
      const nowAnyEnabled = next.dailyReminder || next.weeklyRecap;
      if (nowAnyEnabled && !previouslyAnyEnabled) {
        void fetch("/api/notifications/welcome", { method: "POST" }).catch(
          (err) => {
            console.warn("[notification-prefs] welcome fetch failed:", err);
          },
        );
      }
    },
    // `state` is in the deps so we read the freshest snapshot. The
    // callback re-creates on each state change — fine for an
    // onChange handler on a checkbox; the consumer just calls
    // `update(...)` and doesn't depend on referential identity.
    [state],
  );

  return { state, update };
}
