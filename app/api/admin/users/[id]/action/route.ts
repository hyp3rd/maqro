import { parseBody } from "@/lib/api/parse-body";
import { getStripe } from "@/lib/billing/stripe";
import { reportServerError } from "@/lib/error-reporter";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { cascadeDeleteUser } from "@/lib/user-deletion";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({
  action: z.enum([
    "ban",
    "unban",
    "trace",
    "untrace",
    "cancel_subscription",
    "delete_user",
  ]),
  banDuration: z.enum(["24h", "7d", "30d", "permanent"]).optional(),
  reason: z.string().optional(),
});

/** POST /api/admin/users/[id]/action - single endpoint for the
 *  Users detail-page action panel. The body's `action` field
 *  discriminates between five operator moves:
 *
 *    - `ban`              - Supabase `updateUserById({ ban_duration: 'forever' })`.
 *                           Active sessions revoke on next token-refresh; the
 *                           login flow returns 400 for a banned user. Audit
 *                           row written as `user.ban` so the audit page can
 *                           filter.
 *    - `unban`            - `ban_duration: 'none'`. Mirrors the above.
 *    - `trace`            - flips `profiles.traced = true`. The error reporter
 *                           consults this flag and captures expanded context
 *                           for the user's events. Audit row: `user.trace`.
 *    - `untrace`          - `profiles.traced = false`.
 *    - `cancel_subscription` - cancels the user's Stripe subscription at
 *                           period end (matches the Settings UX). 404 if the
 *                           user has no active sub; 409 if already cancelled.
 *                           Audit row: `user.subscription.cancel`.
 *    - `delete_user`      - runs the same cascade as /api/delete-account
 *                           (Stripe cancel + storage cleanup +
 *                           auth.users delete). Irreversible. Requires a
 *                           reason; the route's self-target guard
 *                           prevents an admin from deleting themselves
 *                           through this path. Audit row: `user.delete`.
 *
 *  Five-plus endpoints would be cleaner from a REST purity
 *  standpoint but the action panel renders all the buttons against
 *  one user id and the wire-up cost of separate routes doesn't pay
 *  off. The dispatch-on-body shape matches our existing
 *  `/api/auth/recovery` and webhook-handler patterns. */

type ActionKind = z.infer<typeof BodySchema>["action"];

/** Actions where a reason is mandatory in the audit trail. Done
 *  via runtime check (vs `.refine` on the Zod schema) so the error
 *  copy stays human-readable instead of becoming a generic Zod
 *  field error. */
const ACTIONS_REQUIRING_REASON = new Set<ActionKind>([
  "ban",
  "trace",
  "delete_user",
]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id: targetUserId } = await ctx.params;
  // UUID v4 check - Supabase user ids are always v4 UUIDs.
  // Catching malformed ids early avoids round-tripping to
  // Supabase and getting a generic 500 back.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      targetUserId,
    )
  ) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }
  if (targetUserId === guard.userId) {
    // Defensive: an admin shouldn't be able to ban themselves.
    // The action panel hides destructive buttons for self, but
    // a hand-crafted POST shouldn't bypass that.
    return NextResponse.json(
      { error: "You can't perform this action on your own account." },
      { status: 400 },
    );
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { action, banDuration } = parsed.data;
  const reason = parsed.data.reason?.trim() || null;
  if (ACTIONS_REQUIRING_REASON.has(action) && !reason) {
    return NextResponse.json(
      { error: "A reason is required for this action." },
      { status: 400 },
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

  switch (action) {
    case "ban":
    case "unban": {
      // Supabase's ban API uses a Postgres interval string. "none"
      // lifts; "24h", "168h", … applies. We expose a small
      // whitelist of durations + "permanent". The documented
      // literal `"forever"` is rejected by the current
      // updateUserById implementation (the operator reported a
      // 500); we map "permanent" to 100 years instead - the
      // de-facto Supabase pattern for a hard ban.
      let duration: string;
      if (action === "unban") {
        duration = "none";
      } else {
        const requested = banDuration ?? "7d";
        duration =
          requested === "permanent"
            ? "876000h"
            : requested === "24h"
              ? "24h"
              : requested === "30d"
                ? "720h"
                : "168h"; // 7d default
      }
      const { error } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: duration,
      });
      if (error) {
        await reportServerError(error, {
          route: "/api/admin/users/[id]/action",
          context: { action, targetUserId },
        });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const auditPayload: Record<string, unknown> = { reason };
      if (action === "ban") {
        auditPayload.duration = duration;
        auditPayload.requested = banDuration ?? "7d";
      }
      await writeAuditLog({
        adminUserId: guard.userId,
        action: `user.${action}`,
        targetUserId,
        payload: auditPayload,
      });
      // Mirror into trace_events when the target is flagged so
      // operators see the admin action inline in the per-user
      // trace panel (not just in the global audit log).
      const { recordTraceEvent } = await import("@/lib/admin-trace");
      void recordTraceEvent({
        userId: targetUserId,
        kind: `admin.${action}`,
        payload: { ...auditPayload, by_admin: guard.userId },
      });
      return NextResponse.json({ ok: true });
    }

    case "trace":
    case "untrace": {
      // `profiles.traced` column added in migration 0033. Drives
      // the trace-capture mechanism in `lib/admin-trace.ts` -
      // when true, the proxy auto-logs API requests from this
      // user and the error reporter enriches their events.
      const next = action === "trace";
      const { error } = await admin
        .from("profiles")
        .update({ traced: next })
        .eq("user_id", targetUserId);
      if (error) {
        await reportServerError(error, {
          route: "/api/admin/users/[id]/action",
          context: { action, targetUserId },
        });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      // Invalidate the per-process cache so the next request from
      // this user picks up the flip without waiting for the 60s
      // TTL to elapse. Other server processes will pick up the
      // change at their own cache expiry.
      const { invalidateTracedCache } = await import("@/lib/admin-trace");
      invalidateTracedCache(targetUserId);
      await writeAuditLog({
        adminUserId: guard.userId,
        action: `user.${action}`,
        targetUserId,
        payload: { reason },
      });
      return NextResponse.json({ ok: true, traced: next });
    }

    case "delete_user": {
      // Same cascade as /api/delete-account (Stripe cancel +
      // Storage cleanup + auth.users delete). Audit log goes first
      // so the "who deleted what, when, and why" record survives
      // even if the cascade itself partially fails - the row would
      // otherwise be impossible to reconstruct after the user is
      // gone.
      await writeAuditLog({
        adminUserId: guard.userId,
        action: "user.delete",
        targetUserId,
        payload: { reason },
      });
      const result = await cascadeDeleteUser({
        userId: targetUserId,
        admin,
        callerRoute: "/api/admin/users/[id]/action",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "cancel_subscription": {
      const stripe = getStripe();
      if (!stripe) {
        return NextResponse.json(
          { error: "Stripe is not configured on this deployment." },
          { status: 503 },
        );
      }
      const { data: profile } = await admin
        .from("profiles")
        .select("stripe_customer_id")
        .eq("user_id", targetUserId)
        .maybeSingle();
      const customerId = profile?.stripe_customer_id as string | undefined;
      if (!customerId) {
        return NextResponse.json(
          { error: "User has no Stripe customer." },
          { status: 404 },
        );
      }
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1,
      });
      const sub = subs.data[0];
      if (!sub) {
        return NextResponse.json(
          { error: "User has no subscription." },
          { status: 404 },
        );
      }
      if (sub.status === "canceled") {
        return NextResponse.json(
          { error: "Subscription is already cancelled." },
          { status: 409 },
        );
      }
      const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      });
      await writeAuditLog({
        adminUserId: guard.userId,
        action: "user.subscription.cancel",
        targetUserId,
        payload: {
          reason,
          stripe_subscription_id: sub.id,
          stripe_customer_id: customerId,
        },
      });
      // Mirror into the trace log when the user is flagged.
      const { recordTraceEvent } = await import("@/lib/admin-trace");
      void recordTraceEvent({
        userId: targetUserId,
        kind: "admin.subscription.cancel",
        payload: {
          reason,
          stripe_subscription_id: sub.id,
          by_admin: guard.userId,
        },
      });
      return NextResponse.json({
        ok: true,
        cancelAtPeriodEnd: updated.cancel_at_period_end,
      });
    }
  }
}
