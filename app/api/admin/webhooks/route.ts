import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** GET the recorded Stripe webhook events, descending by created_at.
 *
 *  Query params:
 *    - `status` — `all` (default) | `success` | `error` | `pending`.
 *      `pending` matches rows where processing_status is NULL —
 *      typically very old rows from before migration 0027 was
 *      applied, or events still mid-flight.
 *    - `since`  — `1h` | `24h` | `7d` | `30d` | `all`. Default `7d`
 *      so the operator usually lands on a useful slice.
 *    - `page`   — 1-indexed page (combines with `per`). Default 1.
 *    - `per`    — page size, capped at 500. Default 25.
 *
 *  Powers [/admin/webhooks](../../../admin/webhooks/page.tsx).
 *  Service-role client bypasses RLS; the route guard ensures only
 *  admins can hit this endpoint. */

const DEFAULT_PER = 25;
const MAX_PER = 500;

const RANGES: Record<string, number | null> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
  all: null,
};

export async function GET(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "all";
  const sinceParam = url.searchParams.get("since") ?? "7d";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const per = Math.min(
    MAX_PER,
    Math.max(1, Number(url.searchParams.get("per") ?? String(DEFAULT_PER))),
  );

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

  let query = admin
    .from("stripe_webhook_events")
    .select(
      "id, type, created_at, processed_at, processing_status, processing_error, replayed_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * per, page * per - 1);

  // Status filter — strict allowlist so a malformed param can't
  // smuggle through. `pending` is the special case (NULL match).
  if (statusParam === "success" || statusParam === "error") {
    query = query.eq("processing_status", statusParam);
  } else if (statusParam === "pending") {
    query = query.is("processing_status", null);
  }
  // else "all" — no filter

  // `??` would collapse `since=all` (which deliberately maps to
  // `null`) to the 7d default — `null ?? 7d_ms === 7d_ms`. Use an
  // explicit `in` check so the `all` sentinel survives.
  const sinceMs = sinceParam in RANGES ? RANGES[sinceParam] : RANGES["7d"];
  if (sinceMs !== null && sinceMs !== undefined) {
    const cutoff = new Date(Date.now() - sinceMs).toISOString();
    query = query.gte("created_at", cutoff);
  }

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    status: statusParam,
    since: sinceParam,
    page,
    per,
  });
}
