import type { Meal } from "@/components/macro/types";
import { getAppUrl } from "@/lib/app-url";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import { FEATURES } from "@/lib/billing/tiers";
import { loadUserTier } from "@/lib/billing/usage";
import type { DailyLog, WeightEntry } from "@/lib/db";
import { sendEmail } from "@/lib/email/resend";
import { weeklyRecapEmail } from "@/lib/email/templates";
import { loadLatestBodyFatPct } from "@/lib/latest-body-fat";
import { localDateInTimeZone } from "@/lib/local-time";
import { emailsById, listAllAuthUsers } from "@/lib/supabase/admin-users";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { personalInfoFromPayload } from "@/lib/sync/mappers";
import { computeWeeklyRecap } from "@/lib/weekly-recap";
import { NextResponse } from "next/server";
import { targetsForDate, targetsUseBodyFat } from "@maqro/core/targets";
import { createClient } from "@supabase/supabase-js";

/** Vercel cron handler — Monday-morning "your week in macros"
 *  digest. Schedule (see `vercel.json`): Mondays at 08:00 UTC, which
 *  is morning-ish across Europe and pre-workday in eastern US.
 *
 *  Pulls last 7 days of logs + weights for each opted-in user,
 *  computes the recap with the SAME `computeWeeklyRecap` helper the
 *  Progress view uses, scoring each day against the SAME target the app
 *  shows for it (the shared `targetsForDate` resolver, with the user's tier
 *  re-checked here so an active Pro goal phase counts exactly as in-app),
 *  and sends. "Today" is
 *  the user's local date when they've stored a timezone, else UTC.
 *
 *  Auth + admin-client pattern matches the daily-reminder route. */
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

  // 1. Opted-in users.
  const { data: prefRows, error: prefErr } = await admin
    .from("notification_preferences")
    .select("user_id, timezone")
    .eq("weekly_recap", true);
  if (prefErr) {
    console.error("[cron/weekly-recap] prefs read failed:", prefErr);
    return NextResponse.json({ error: prefErr.message }, { status: 500 });
  }
  const optedIn = prefRows ?? [];
  if (optedIn.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, errors: 0 });
  }

  // 2. Email map over every auth user (paged — a bare listUsers()
  //    returns only the first 50).
  const { users, error: usersErr } = await listAllAuthUsers(admin.auth.admin);
  if (usersErr) {
    console.error("[cron/weekly-recap] listUsers failed:", usersErr);
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }
  const emailById = emailsById(users);

  const now = new Date();
  const todayUtc = currentDateUtc(now);
  const appUrl = getAppUrl();

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

    // The user's local "today" (the same day key their app uses); users
    // who never stored a timezone keep the historical UTC day. The window
    // is still the 7 days ending today.
    const timeZone = (pref.timezone as string | null) ?? null;
    const today = timeZone ? localDateInTimeZone(now, timeZone) : todayUtc;
    const weekStart = subtractDaysUtc(today, 6);

    // Profile — needed for target calories used in the
    // adherence-days calculation. If the user has no profile yet
    // (no row, or the `{}` placeholder migration 0074 creates at
    // sign-up), we still send a recap; we just pass target=0 and the
    // template adjusts ("On-target days: —").
    const { data: profile } = await admin
      .from("profiles")
      .select("payload")
      .eq("user_id", userId)
      .maybeSingle();
    const personalInfo = personalInfoFromPayload(profile?.payload);
    // Goal phases are Pro: re-check the tier server-side (fail-closed to
    // free) rather than trust anything in the payload.
    const phasesEnabled = personalInfo
      ? FEATURES.canUseGoalPhases(await loadUserTier(admin, userId))
      : false;
    // The same body-fat estimate the app derives, so a training day's
    // target matches what the user sees. A failed read skips this user
    // rather than score the week against a target the app wouldn't show.
    // Only an enabled training schedule reads it: otherwise there is no
    // read (and no failure) that could change the targets.
    let bodyFatPct: number | null = null;
    if (personalInfo && targetsUseBodyFat(personalInfo)) {
      const bodyFat = await loadLatestBodyFatPct(admin, userId, personalInfo);
      if (!bodyFat.ok) {
        console.error(
          "[cron/weekly-recap] body measurements read failed:",
          bodyFat.error,
        );
        errors++;
        continue;
      }
      bodyFatPct = bodyFat.bodyFatPct;
    }
    // Each logged day is scored against its OWN target (a phase change or a
    // planned training day inside the window); the email shows today's.
    const targetCaloriesFor = (date: string) =>
      personalInfo
        ? targetsForDate(personalInfo, date, { phasesEnabled, bodyFatPct })
            .targetCalories
        : 0;
    const targetCalories = targetCaloriesFor(today);

    // Last 7 days of logs + weights. The helper takes the full
    // arrays and filters internally; passing pre-filtered is just
    // a transport-layer optimization.
    const { data: logRows } = await admin
      .from("daily_logs")
      .select("date, meals, updated_at")
      .eq("user_id", userId)
      .gte("date", weekStart)
      .order("date", { ascending: true });
    const logs: DailyLog[] = (logRows ?? []).map((row) => ({
      date: row.date as string,
      meals: row.meals as Meal[],
      updatedAt: Date.parse(row.updated_at as string),
      localUpdatedAt: row.updated_at as string,
      serverUpdatedAt: row.updated_at as string,
    }));

    const { data: weightRows } = await admin
      .from("weight_history")
      .select("date, kg, recorded_at, updated_at")
      .eq("user_id", userId)
      .gte("date", weekStart)
      .order("date", { ascending: true });
    const weights: WeightEntry[] = (weightRows ?? []).map((row) => ({
      date: row.date as string,
      kg: row.kg as number,
      recordedAt: Date.parse(row.recorded_at as string),
      localUpdatedAt: row.updated_at as string,
      serverUpdatedAt: row.updated_at as string,
    }));

    const recap = computeWeeklyRecap(logs, weights, targetCaloriesFor, today);

    // Don't waste an inbox slot when the user logged nothing all
    // week — empty digests are annoying. Skip silently; they'll
    // get one next week if they start logging.
    if (recap.daysLogged === 0) {
      skipped++;
      continue;
    }

    const { subject, html, text } = weeklyRecapEmail({
      appUrl,
      recap,
      targetCalories,
    });
    const result = await sendEmail({ to: email, subject, html, text });
    if ("ok" in result && result.ok) {
      sent++;
    } else if ("skipped" in result) {
      console.warn(`[cron/weekly-recap] email skipped: ${result.reason}`);
      return NextResponse.json({
        sent,
        skipped: skipped + (optedIn.length - sent),
        errors,
        reason: result.reason,
      });
    } else {
      console.error("[cron/weekly-recap] send error:", result.error);
      errors++;
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}

function currentDateUtc(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function subtractDaysUtc(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear();
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getUTCDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
