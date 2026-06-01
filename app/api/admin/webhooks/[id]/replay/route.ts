import { getStripe } from "@/lib/billing/stripe";
import { dispatchStripeEvent } from "@/lib/billing/webhook-handlers";
import { requireHumanDeep } from "@/lib/bot-protection";
import { reportServerError } from "@/lib/error-reporter";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/** Admin-triggered replay of a previously-recorded Stripe webhook
 *  event. The row's stored payload is fed back through the same
 *  dispatcher the live route uses, and the row's status fields are
 *  updated with the new outcome plus replay metadata.
 *
 *  Guard rails:
 *
 *    - Admin-only (RBAC). Misuse would write to user profiles
 *      based on stale or hand-crafted Stripe data.
 *    - The event id in the URL is sanity-checked (`evt_` prefix)
 *      before any DB call. Stripe-emitted ids all start with
 *      `evt_`; rejecting anything else closes off the path before
 *      query-string smuggling could matter.
 *    - We refuse to replay a row that has no payload — replay is
 *      only meaningful for events recorded under migration 0027+.
 *    - Every replay writes one row to `admin_audit_log` so the
 *      operator trail captures who replayed what, when.
 *
 *  Idempotency: replay is **NOT** idempotent at the Stripe level.
 *  The dispatcher writes to `profiles`; replaying a `subscription.
 *  updated` after a more-recent one has been processed could
 *  overwrite the current state with stale values. The admin UI
 *  shows the current `processing_status` so the operator can
 *  decide; this route just runs what it's asked to run. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Bot gate first — even an admin session shouldn't be able to
  // replay events via an automated script outside the admin UI.
  // Deep-analysis because replay can overwrite billing state.
  const bot = await requireHumanDeep();
  if (!bot.ok) return bot.response;

  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!id || !id.startsWith("evt_")) {
    return NextResponse.json({ error: "Invalid event id." }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }

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

  const { data: row, error: fetchError } = await admin
    .from("stripe_webhook_events")
    .select("id, type, payload")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (!row.payload) {
    return NextResponse.json(
      {
        error:
          "This event was recorded before payloads were captured (migration 0027). Replay isn't possible.",
      },
      { status: 422 },
    );
  }

  // Dispatch against the stored payload. The dispatcher catches
  // its own throws and returns a typed outcome; we never need a
  // try/catch around this call.
  const outcome = await dispatchStripeEvent(
    row.payload as Stripe.Event,
    admin,
    stripe,
  );
  const now = new Date().toISOString();

  await admin
    .from("stripe_webhook_events")
    .update({
      processed_at: now,
      processing_status: outcome.status,
      processing_error:
        outcome.status === "error" ? outcome.error.message : null,
      replayed_at: now,
      replayed_by: guard.userId,
    })
    .eq("id", id);

  await writeAuditLog({
    adminUserId: guard.userId,
    action: "stripe_webhook_replay",
    payload: { event_id: id, event_type: row.type, outcome: outcome.status },
  });

  if (outcome.status === "error") {
    await reportServerError(outcome.error, {
      route: "/api/admin/webhooks/[id]/replay",
      context: { event_id: id, event_type: row.type, replayed: true },
    });
    return NextResponse.json({ status: "error", error: outcome.error.message });
  }

  return NextResponse.json({ status: "success" });
}
