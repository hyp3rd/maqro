import { getAppUrl } from "@/lib/app-url";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import { sendEmail } from "@/lib/email/resend";
import { supplementReminderEmail } from "@/lib/email/templates";
import { localDateInTimeZone, localHourInTimeZone } from "@/lib/local-time";
import { sendPush } from "@/lib/push/send";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { scheduleFiresAt } from "@/lib/supplements";
import { NextResponse } from "next/server";
import type { SupplementSchedule } from "@maqro/core/records";
import { createClient } from "@supabase/supabase-js";

/** Vercel cron handler — hourly supplement reminders.
 *
 *  Schedule (see `vercel.json`): every hour (`0 * * * *`), like the daily
 *  reminder. For each user with `supplement_reminders = true`, in their local
 *  timezone, send a reminder for every supplement whose schedule's
 *  `reminderTimes` includes the current local hour AND whose `daysOfWeek`
 *  includes today's weekday. The `supplement_reminders` toggle is the master
 *  opt-in: email always, push additionally when `push_enabled`.
 *
 *  Idempotency: a claim-first lock in `supplement_reminder_sends` keyed by
 *  (user, supplement, local_date, hour) — the insert IS the lock, so the same
 *  scheduled time fires at most once per local day even across the hourly
 *  re-fires. Old lock rows are pruned each run.
 *
 *  Auth: Vercel cron supplies `Authorization: Bearer CRON_SECRET`. */

/** UTC `YYYY-MM-DD` minus `n` days — for pruning the dedup ledger. */
function subtractUtcDays(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Local weekday (0=Sun … 6=Sat) of a `YYYY-MM-DD` calendar date. A date's
 *  weekday is fixed, so this is timezone-independent. */
function weekdayOf(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

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

  const { data: prefRows, error: prefErr } = await admin
    .from("notification_preferences")
    .select("user_id, push_enabled, timezone, supplement_reminders")
    .eq("supplement_reminders", true);
  if (prefErr) {
    console.error("[cron/supplement-reminders] prefs read failed:", prefErr);
    return NextResponse.json({ error: prefErr.message }, { status: 500 });
  }
  const optedIn = prefRows ?? [];
  if (optedIn.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, errors: 0 });
  }

  // Keep the dedup ledger tiny: drop rows older than 2 days (safe across all
  // timezones since a user's local date is within ±1 of the UTC date).
  const { error: pruneErr } = await admin
    .from("supplement_reminder_sends")
    .delete()
    .lt("local_date", subtractUtcDays(2));
  if (pruneErr) {
    console.error("[cron/supplement-reminders] ledger prune failed:", pruneErr);
  }

  const { data: usersData, error: usersErr } =
    await admin.auth.admin.listUsers();
  if (usersErr) {
    console.error("[cron/supplement-reminders] listUsers failed:", usersErr);
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }
  const emailById = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const appUrl = getAppUrl();
  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const pref of optedIn) {
    const userId = pref.user_id as string;
    try {
      const tz = (pref.timezone as string | null) ?? "UTC";
      const localDate = localDateInTimeZone(now, tz);
      const localHour = localHourInTimeZone(now, tz);
      const dow = weekdayOf(localDate);

      const { data: suppRows } = await admin
        .from("supplements")
        .select("id, name, dose_label, schedule")
        .eq("user_id", userId);
      const due = (suppRows ?? []).filter((s) =>
        scheduleFiresAt(
          (s.schedule ?? undefined) as SupplementSchedule | undefined,
          localHour,
          dow,
        ),
      );
      if (due.length === 0) {
        skipped++;
        continue;
      }

      const email = emailById.get(userId);
      const pushEnabled = pref.push_enabled === true;

      for (const supp of due) {
        const suppId = supp.id as string;
        // Claim-first dedup: a unique-violation (23505) means this hour's
        // reminder already went out today → skip without re-sending.
        const { error: lockErr } = await admin
          .from("supplement_reminder_sends")
          .insert({
            user_id: userId,
            supplement_id: suppId,
            local_date: localDate,
            sent_hour: localHour,
          });
        if (lockErr) {
          if (lockErr.code !== "23505") {
            console.error(
              "[cron/supplement-reminders] lock insert failed:",
              lockErr,
            );
            errors++;
          }
          continue;
        }

        const name = supp.name as string;
        const doseLabel = (supp.dose_label as string | null) ?? undefined;

        if (email) {
          const { subject, html, text } = supplementReminderEmail({
            appUrl,
            name,
            doseLabel,
          });
          const result = await sendEmail({ to: email, subject, html, text });
          if ("error" in result) {
            console.error(
              "[cron/supplement-reminders] email send error:",
              result.error,
            );
          }
        }

        if (pushEnabled) {
          const { data: subs } = await admin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("user_id", userId);
          for (const sub of subs ?? []) {
            const r = await sendPush(
              {
                endpoint: sub.endpoint as string,
                p256dh: sub.p256dh as string,
                auth: sub.auth as string,
              },
              {
                title: `Time for your ${name}`,
                body: "Tap to mark it as taken.",
                url: `${appUrl}/app?view=progress`,
                tag: "supplement-reminder",
              },
            );
            if (!r.ok && r.gone) {
              await admin
                .from("push_subscriptions")
                .delete()
                .eq("id", sub.id as string)
                .then(undefined, (e: unknown) =>
                  console.error(
                    "[cron/supplement-reminders] sub reap failed:",
                    e,
                  ),
                );
            } else if (!r.ok) {
              console.error(
                "[cron/supplement-reminders] push send error:",
                r.error,
              );
            }
          }
        }
        sent++;
      }
    } catch (err) {
      console.error("[cron/supplement-reminders] user failed:", userId, err);
      errors++;
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}
