import { parseBody } from "@/lib/api/parse-body";
import { currentPeriodStart } from "@/lib/billing/usage";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ count: z.number().int().min(0).max(100_000) });

/** PATCH a user's AI usage counter for the current month. Body:
 *  `{ count: number }` (absolute, not delta - easier to reason
 *  about for "set them back to 0 because their refund landed").
 *
 *  Use cases:
 *    - Refund a failed AI call that ate budget.
 *    - Grant a one-time bonus during onboarding.
 *    - Wipe the counter for a user who hit the cap mid-debugging.
 *
 *  The override doesn't change the tier - that's the role / Stripe
 *  surface's job. This route only manipulates the metering counter. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id: targetUserId } = await ctx.params;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const newCount = parsed.data.count;

  const config = getSupabaseSecretConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const periodStart = currentPeriodStart();

  // Read prior count for the audit row.
  const { data: existing } = await admin
    .from("ai_usage_monthly")
    .select("count")
    .eq("user_id", targetUserId)
    .eq("period_start", periodStart)
    .maybeSingle();
  const previousCount = (existing?.count as number | undefined) ?? 0;

  const { error: upsertError } = await admin
    .from("ai_usage_monthly")
    .upsert(
      {
        user_id: targetUserId,
        period_start: periodStart,
        count: newCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,period_start" },
    );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  await writeAuditLog({
    adminUserId: guard.userId,
    action: "ai_usage.set",
    targetUserId,
    payload: { from: previousCount, to: newCount, period_start: periodStart },
  });

  return NextResponse.json({ ok: true, count: newCount });
}
