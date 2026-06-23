import type { Meal, PersonalInfo } from "@/components/macro/types";
import { getAppUrl } from "@/lib/app-url";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import { FEATURES } from "@/lib/billing/tiers";
import { loadUserTier } from "@/lib/billing/usage";
import { sendEmail } from "@/lib/email/resend";
import { autoAdaptEmail } from "@/lib/email/templates";
import { activePhase } from "@/lib/goal-phases";
import { computeMacros } from "@/lib/macros";
import { sendPush } from "@/lib/push/send";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { decideAutoAdapt, inferAdaptiveTdee } from "@/lib/trends";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Notification opt-in flags read for the auto-adapt dispatch. */
type AutoAdaptPrefs = {
  push_enabled: boolean;
  daily_reminder: boolean;
  weekly_recap: boolean;
};

/** Best-effort push + email for one user after their TDEE was adjusted/held.
 *  Push goes to push-enabled users; email goes to users who opted into any
 *  email digest (daily reminder or weekly recap) — we don't email users who
 *  never opted into mail. Per-channel failures are logged, never thrown. */
async function dispatchAutoAdaptNotification(opts: {
  admin: SupabaseClient;
  userId: string;
  email: string | undefined;
  prefs: AutoAdaptPrefs | undefined;
  appUrl: string;
  kind: "applied" | "pending";
  newTdee: number;
  deltaKcal: number;
}): Promise<void> {
  const { admin, userId, email, prefs, appUrl, kind, newTdee, deltaKcal } =
    opts;

  if (prefs?.push_enabled) {
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
          title:
            kind === "applied"
              ? `Maintenance set to ${newTdee} kcal`
              : `New maintenance estimate: ${newTdee} kcal`,
          body:
            kind === "applied"
              ? "Auto-adapt updated your daily target — tap to review."
              : "Tap to review and apply.",
          url: `${appUrl}/app?view=progress`,
          tag: "auto-adapt-tdee",
        },
      );
      if (!result.ok && result.gone) {
        // Dead subscription — reap it so future runs skip it. Best-effort: a
        // reap failure must not block the remaining sends, but is worth a log.
        await admin
          .from("push_subscriptions")
          .delete()
          .eq("id", sub.id as string)
          .then(undefined, (e: unknown) =>
            console.error("[cron/auto-adapt-tdee] sub reap failed:", e),
          );
      } else if (!result.ok) {
        console.error("[cron/auto-adapt-tdee] push send error:", result.error);
      }
    }
  }

  // Email only to the weekly-digest audience: auto-adapt is a weekly event, so
  // `weekly_recap` is the aligned opt-in — a daily-reminder-only user (who wants
  // "log your meal" nudges, not a weekly summary) isn't emailed about TDEE.
  if (email && prefs?.weekly_recap) {
    const tmpl = autoAdaptEmail({ appUrl, kind, newTdee, deltaKcal });
    const sent = await sendEmail({
      to: email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
    });
    // `skipped` (no RESEND env) is a deploy choice, not an error; a real send
    // failure is worth surfacing.
    if ("error" in sent) {
      console.error("[cron/auto-adapt-tdee] email send error:", sent.error);
    }
  }
}

/** Vercel cron handler — weekly hands-off auto-adapt of the maintenance TDEE.
 *
 *  Schedule (see `vercel.json`): once weekly (Monday). For each Pro user who
 *  opted in (`payload.autoAdaptTdee === true`):
 *    1. Re-check Pro (a downgrade stops auto-adapt — the toggle stays but the
 *       cron no longer acts).
 *    2. Re-estimate maintenance from logged intake vs. the weight trend
 *       (`inferAdaptiveTdee`), exactly like Progress → Trends.
 *    3. Decide via the shared hybrid policy (`decideAutoAdapt`): a small change
 *       (≤ the step cap) is APPLIED automatically (writes `manualTdee`); a large
 *       one is HELD for a one-tap in-app confirm; an uncertain / within-noise
 *       estimate is SKIPPED.
 *    4. Record the outcome on `autoAdaptSuggestion` so the app surfaces it (a
 *       reversible "we adjusted it" heads-up, or the pending confirm). This IS
 *       the user-facing notification for v1 — a proactive push/email is a
 *       deliberate follow-up.
 *
 *  The profile write bumps `updated_at`, so the change syncs to the user's
 *  devices on their next pull (same path as any server-side profile change).
 *  Per-user failures are isolated + logged; one bad row never kills the batch.
 *
 *  Auth: Vercel cron supplies `Authorization: Bearer CRON_SECRET`. */
const MAX_USERS = 500;

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

  // Opted-in profiles only. `payload->>autoAdaptTdee` extracts the JSON boolean
  // as text, so the JSON `true` matches the string "true"; rows without the
  // flag yield null and are excluded.
  const { data: rows, error: selErr } = await admin
    .from("profiles")
    .select("user_id, payload")
    .eq("payload->>autoAdaptTdee", "true")
    .limit(MAX_USERS);
  if (selErr) {
    console.error("[cron/auto-adapt-tdee] profile read failed:", selErr);
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  const optedIn = rows ?? [];
  // The `.limit(MAX_USERS)` caps the batch; if we hit it exactly, more opted-in
  // users likely exist and got silently dropped this run. Surface it (logs +
  // response) rather than letting `optedIn: 500` look like a complete pass.
  // Pagination is the fix if opt-in counts ever routinely approach the cap.
  const truncated = optedIn.length === MAX_USERS;
  if (truncated) {
    console.warn(
      `[cron/auto-adapt-tdee] hit MAX_USERS=${MAX_USERS}; some opted-in users were not processed this run.`,
    );
  }

  // For the per-user notification dispatch: one listUsers call for emails + a
  // batch read of notification prefs. (Both unpaginated, matching the other
  // crons — fine until opted-in counts approach the 1000-user page size.)
  const appUrl = getAppUrl();
  const emailById = new Map<string, string>();
  const prefById = new Map<string, AutoAdaptPrefs>();
  if (optedIn.length > 0) {
    const { data: usersData } = await admin.auth.admin.listUsers();
    const userList = usersData?.users ?? [];
    if (userList.length >= 1000) {
      console.warn(
        "[cron/auto-adapt-tdee] listUsers hit the default page size; the email map may be incomplete (paginate if this recurs).",
      );
    }
    for (const u of userList) {
      if (u.email) emailById.set(u.id, u.email);
    }
    const { data: prefRows } = await admin
      .from("notification_preferences")
      .select("user_id, push_enabled, daily_reminder, weekly_recap")
      .in(
        "user_id",
        optedIn.map((r) => r.user_id as string),
      );
    for (const p of prefRows ?? []) {
      prefById.set(p.user_id as string, {
        push_enabled: Boolean(p.push_enabled),
        daily_reminder: Boolean(p.daily_reminder),
        weekly_recap: Boolean(p.weekly_recap),
      });
    }
  }

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  let applied = 0;
  let held = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of optedIn) {
    const userId = row.user_id as string;
    try {
      const profile = row.payload as PersonalInfo;

      // A downgrade stops auto-adapt (the cron re-checks; the toggle is inert).
      const tier = await loadUserTier(admin, userId);
      if (!FEATURES.canAutoAdaptTdee(tier)) {
        skipped++;
        continue;
      }

      // If the active goal phase carries its own (manually-pinned) TDEE
      // override, auto-adapt leaves it alone — the user calibrated this phase
      // deliberately, and a global manualTdee write would be shadowed by the
      // phase override anyway. The two calibration modes stay distinct.
      const phase = activePhase(profile.goalPhases, today);
      if (phase?.tdeeOverride && phase.tdeeOverride > 0) {
        skipped++;
        continue;
      }

      const [{ data: wRows }, { data: lRows }] = await Promise.all([
        admin
          .from("weight_history")
          .select("date, kg, recorded_at")
          .eq("user_id", userId)
          .order("date", { ascending: true }),
        admin
          .from("daily_logs")
          .select("date, meals")
          .eq("user_id", userId)
          .lte("date", today),
      ]);

      const weights = (wRows ?? []).map((r) => ({
        date: r.date as string,
        kg: r.kg as number,
        recordedAt: (r.recorded_at as number | null) ?? 0,
      }));
      const intake = (lRows ?? []).map((r) => ({
        date: r.date as string,
        calories: ((r.meals as Meal[] | null) ?? []).reduce(
          (s, m) => s + m.foods.reduce((ms, f) => ms + f.calories, 0),
          0,
        ),
      }));

      const observed = inferAdaptiveTdee({ weights, intake });
      // computeMacros already applies any existing manualTdee override, so this
      // is the exact TDEE the user's targets currently use.
      const currentTdee = computeMacros(profile).tdee;
      const decision = decideAutoAdapt({ observed, currentTdee });
      if (decision.action === "skip" || decision.newTdee === null) {
        skipped++;
        continue;
      }

      const kind: "applied" | "pending" =
        decision.action === "apply" ? "applied" : "pending";
      const nextPayload: PersonalInfo = {
        ...profile,
        // "apply" pins the new maintenance now; "hold" leaves the target as-is
        // and only records the pending suggestion for the user to confirm.
        ...(decision.action === "apply"
          ? { manualTdee: decision.newTdee }
          : {}),
        autoAdaptSuggestion: {
          kind,
          tdee: decision.newTdee,
          deltaKcal: decision.deltaKcal,
          createdAt: Date.now(),
        },
      };

      const { error: upErr } = await admin
        .from("profiles")
        .update({ payload: nextPayload, updated_at: nowIso })
        .eq("user_id", userId);
      if (upErr) {
        console.error("[cron/auto-adapt-tdee] profile write failed:", upErr);
        errors++;
        continue;
      }
      if (decision.action === "apply") applied++;
      else held++;

      // Best-effort push + email — the change is already persisted (and shown
      // in-app via autoAdaptSuggestion), so a notification failure never undoes
      // it or counts as an error.
      try {
        await dispatchAutoAdaptNotification({
          admin,
          userId,
          email: emailById.get(userId),
          prefs: prefById.get(userId),
          appUrl,
          kind,
          newTdee: decision.newTdee,
          deltaKcal: decision.deltaKcal,
        });
      } catch (notifyErr) {
        console.error(
          "[cron/auto-adapt-tdee] notify failed:",
          userId,
          notifyErr,
        );
      }
    } catch (err) {
      console.error("[cron/auto-adapt-tdee] user failed:", userId, err);
      errors++;
    }
  }

  return NextResponse.json({
    optedIn: optedIn.length,
    applied,
    held,
    skipped,
    errors,
    truncated,
  });
}
