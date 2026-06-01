import type { Meal, PersonalInfo } from "@/components/macro/types";
import { getAppUrl } from "@/lib/app-url";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import type { DailyLog, WeightEntry } from "@/lib/db";
import { sendEmail } from "@/lib/email/resend";
import { weeklyRecapEmail } from "@/lib/email/templates";
import { computeMacros } from "@/lib/macros";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { computeWeeklyRecap } from "@/lib/weekly-recap";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Vercel cron handler — Monday-morning "your week in macros"
 *  digest. Schedule (see `vercel.json`): Mondays at 08:00 UTC, which
 *  is morning-ish across Europe and pre-workday in eastern US.
 *
 *  Pulls last 7 days of logs + weights for each opted-in user,
 *  computes the recap with the SAME `computeWeeklyRecap` helper the
 *  Progress view uses (so the numbers in the email match what the
 *  user sees in-app), and sends.
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
    .select("user_id")
    .eq("weekly_recap", true);
  if (prefErr) {
    console.error("[cron/weekly-recap] prefs read failed:", prefErr);
    return NextResponse.json({ error: prefErr.message }, { status: 500 });
  }
  const optedIn = prefRows ?? [];
  if (optedIn.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, errors: 0 });
  }

  // 2. Email map.
  const { data: usersData, error: usersErr } =
    await admin.auth.admin.listUsers();
  if (usersErr) {
    console.error("[cron/weekly-recap] listUsers failed:", usersErr);
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }
  const emailById = new Map<string, string>();
  for (const u of usersData?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const todayUtc = currentDateUtc();
  const weekStart = subtractDaysUtc(todayUtc, 6);
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

    // Profile — needed for target calories used in the
    // adherence-days calculation. If the profile row is missing,
    // we still send a recap; we just pass target=0 and the
    // template adjusts ("On-target days: —").
    const { data: profile } = await admin
      .from("profiles")
      .select("payload")
      .eq("user_id", userId)
      .maybeSingle();
    const personalInfo = (profile?.payload as PersonalInfo | undefined) ?? null;
    const targetCalories = personalInfo
      ? Math.round(computeMacros(personalInfo).targetCalories)
      : 0;

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

    const recap = computeWeeklyRecap(logs, weights, targetCalories, todayUtc);

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
