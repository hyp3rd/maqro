import type { Meal } from "@/components/macro/types";
import { getAppUrl } from "@/lib/app-url";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import type { DailyLog } from "@/lib/db";
import { sendEmail } from "@/lib/email/resend";
import { dailyReminderEmail } from "@/lib/email/templates";
import { shouldSendReminder } from "@/lib/local-time";
import { sendPush } from "@/lib/push/send";
import { computeStreak } from "@/lib/streaks";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Vercel cron handler — daily "log your dinner" reminder.
 *
 *  Schedule (see `vercel.json`): once daily at 18:00 UTC. That's
 *  late afternoon / evening for Europe (the bulk of the early user
 *  base), morning-ish for US, late night in Asia — not perfectly
 *  localized but good enough for v1. The `timezone` column on
 *  `notification_preferences` is reserved for the per-user time-of-
 *  day refactor when usage demands it.
 *
 *  Selection logic:
 *    1. Find users with `daily_reminder = true`.
 *    2. For each, fetch today's `daily_logs` row (UTC date).
 *    3. If the row is missing OR has no foods in any meal, send.
 *    4. Skip users who already logged — the reminder is a nudge,
 *       not a digest.
 *
 *  Auth: Vercel cron supplies the `Authorization: Bearer CRON_SECRET`
 *  header. We reject anything without a matching secret to keep the
 *  endpoint from being abusable. */
export async function GET(req: Request): Promise<NextResponse> {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const adminConfig = getSupabaseSecretConfig();
  if (!adminConfig) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(adminConfig.url, adminConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Opted-in users + their localization prefs. The cron now
  //    runs hourly; for each user we ask `shouldSendReminder`
  //    whether their local time-of-day matches their preferred
  //    reminder_hour AND we haven't already sent today (their
  //    local time).
  // Pull anyone with daily_reminder OR push_enabled on. We OR rather
  // than restrict to daily_reminder=true because a user might want
  // push-only (no email noise) — the per-row dispatch below honors
  // each flag independently.
  const { data: prefRows, error: prefErr } = await admin
    .from("notification_preferences")
    .select(
      "user_id, daily_reminder, push_enabled, timezone, reminder_hour, last_reminder_sent_date",
    )
    .or("daily_reminder.eq.true,push_enabled.eq.true");
  if (prefErr) {
    console.error("[cron/daily-reminder] prefs read failed:", prefErr);
    return NextResponse.json({ error: prefErr.message }, { status: 500 });
  }
  const optedIn = prefRows ?? [];
  if (optedIn.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, errors: 0 });
  }

  // 2. Email map (single listUsers call; paginate if we ever cross
  //    the 1000-user default page size).
  const { data: usersData, error: usersErr } =
    await admin.auth.admin.listUsers();
  if (usersErr) {
    console.error("[cron/daily-reminder] listUsers failed:", usersErr);
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }
  const emailById = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const appUrl = getAppUrl();
  const now = new Date();

  // 3. Per-user evaluation. Sequential; N is small at this scale
  //    and the loop's bottleneck is email send, not the queries.
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  for (const pref of optedIn) {
    const userId = pref.user_id as string;
    const email = emailById.get(userId);
    if (!email) {
      skipped++;
      continue;
    }

    // Localization gate: is now the user's chosen hour, and have
    // we not already sent today (their local time)? If either is
    // false, skip without any DB reads — this is the hot path
    // every hour for every opted-in user.
    const { send, localDate } = shouldSendReminder({
      now,
      timeZone: (pref.timezone as string | null) ?? null,
      reminderHour: (pref.reminder_hour as number | undefined) ?? 18,
      lastSentDate:
        (pref.last_reminder_sent_date as string | null | undefined) ?? null,
    });
    if (!send) {
      skipped++;
      continue;
    }

    // Check today's log first — if there's even one food across
    // any meal, the user has already logged and doesn't need the
    // nudge. The `date` column is local-anchored YYYY-MM-DD, so
    // using the user's local date is the right comparison.
    const todayKey = localDate;
    const { data: todayLog } = await admin
      .from("daily_logs")
      .select("meals")
      .eq("user_id", userId)
      .eq("date", todayKey)
      .maybeSingle();
    const todayMeals = (todayLog?.meals ?? []) as Meal[];
    if (todayMeals.some((m) => m.foods.length > 0)) {
      skipped++;
      continue;
    }

    // Pull the user's full history so the email's streak number
    // matches what they see in the app. Cap at last 60 days — we
    // only need recent history for the streak.
    const { data: historyRows } = await admin
      .from("daily_logs")
      .select("date, meals, updated_at")
      .eq("user_id", userId)
      .gte("date", subtractDays(todayKey, 60))
      .order("date", { ascending: true });
    const logs: DailyLog[] = (historyRows ?? []).map((row) => ({
      date: row.date as string,
      meals: row.meals as Meal[],
      updatedAt: Date.parse(row.updated_at as string),
      localUpdatedAt: row.updated_at as string,
      serverUpdatedAt: row.updated_at as string,
    }));
    const streak = computeStreak(logs, todayKey);

    const dailyReminderEnabled = pref.daily_reminder === true;
    const pushEnabled = pref.push_enabled === true;
    const streakLabel =
      streak.current > 0
        ? `Keep your ${streak.current}-day streak alive`
        : "Quick log before bed?";
    let anyChannelSent = false;

    // ── Email channel ───────────────────────────────────────────
    if (dailyReminderEnabled) {
      const { subject, html, text } = dailyReminderEmail({
        appUrl,
        streakDays: streak.current,
      });
      const result = await sendEmail({ to: email, subject, html, text });
      if ("ok" in result && result.ok) {
        anyChannelSent = true;
      } else if ("skipped" in result) {
        // Resend env not configured — bail out of the entire loop
        // since no further sends will succeed. Push may still be
        // configured but this signals a broken deployment so a hard
        // stop is the safer choice.
        console.warn(
          `[cron/daily-reminder] email send skipped: ${result.reason}`,
        );
        return NextResponse.json({
          sent,
          skipped: skipped + (optedIn.length - sent),
          errors,
          reason: result.reason,
        });
      } else {
        console.error("[cron/daily-reminder] email send error:", result.error);
        errors++;
      }
    }

    // ── Push channel ────────────────────────────────────────────
    // Per-device subscriptions: a single user may have multiple.
    // We send to all of them and prune the ones the provider says
    // are gone (404/410). Errors on individual subscriptions don't
    // block sends to the others.
    if (pushEnabled) {
      const { data: subs } = await admin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", userId);
      for (const sub of subs ?? []) {
        const result = await sendPush(
          {
            endpoint: sub.endpoint as string,
            p256dh: sub.p256dh as string,
            auth: sub.auth as string,
          },
          {
            title: streakLabel,
            body:
              streak.current > 0
                ? "Log a meal to keep the streak going."
                : "A quick log keeps your weekly recap honest.",
            url: `${appUrl}/app?view=plan`,
            tag: "daily-reminder",
          },
        );

        // Log every attempt so the admin Engagement tile has data to
        // show. Best-effort: a failed insert just costs us
        // observability for that single send, not the send itself.
        // `error` truncated to 1024 chars so a verbose provider
        // response doesn't blow up row size.
        await admin
          .from("push_send_log")
          .insert({
            user_id: userId,
            subscription_id: sub.id as string,
            status_code: result.ok ? result.status : result.status,
            outcome: result.ok ? "ok" : result.gone ? "gone" : "fail",
            error: result.ok ? null : (result.error ?? "").slice(0, 1024),
            tag: "daily-reminder",
          })
          .then(undefined, (err: unknown) => {
            // `console.error` (not `warn`) so this shows up at the
            // right severity in Vercel cron logs. Losing observability
            // for a single push send is non-fatal to the user
            // (the send already happened), but if the insert
            // ROUTINELY fails it means the admin Engagement tile is
            // silently lying — that's an operator-attention signal
            // we want surfaced loudly.
            console.error(
              "[cron/daily-reminder] push_send_log insert failed:",
              err instanceof Error ? err.message : err,
            );
          });

        if (result.ok) {
          anyChannelSent = true;
        } else if (result.gone) {
          // Subscription is dead — reap so future loops skip it. The
          // log row above survives the deletion (FK is ON DELETE SET
          // NULL) so the "expired today" stat still counts this one.
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id as string);
        } else {
          console.error("[cron/daily-reminder] push send error:", result.error);
          errors++;
        }
      }
    }

    if (anyChannelSent) {
      sent++;
      // Stamp the local date so the next hourly tick treats this
      // user as "already done today" and won't re-send if their
      // reminder_hour rolls over within the same local day. Best-
      // effort: a failed UPDATE here just means we might re-send,
      // which is annoying but not data-corrupting.
      await admin
        .from("notification_preferences")
        .update({ last_reminder_sent_date: localDate })
        .eq("user_id", userId);
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}

/** Subtract `days` from a `YYYY-MM-DD` string. The output is the
 *  same calendar-date arithmetic the rest of the app uses — works
 *  for both UTC-anchored and local-anchored date strings because
 *  it operates on the components, not on a timezone-aware Date. */
function subtractDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear();
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
