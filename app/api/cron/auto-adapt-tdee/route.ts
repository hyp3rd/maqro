import type { Meal, PersonalInfo } from "@/components/macro/types";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import { FEATURES } from "@/lib/billing/tiers";
import { loadUserTier } from "@/lib/billing/usage";
import { computeMacros } from "@/lib/macros";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { decideAutoAdapt, inferAdaptiveTdee } from "@/lib/trends";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  });
}
