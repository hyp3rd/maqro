import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** GET the privacy-stripped error log, descending by `created_at`.
 *
 *  Query params:
 *    - `level`  — `error` (default), `warning`, or `all`. The two
 *                 levels we recognize per the column CHECK constraint.
 *    - `since`  — `1h` | `24h` | `7d` | `30d` | `all`. Default `24h`.
 *                 String enum so URLs are obvious; the route translates
 *                 to an ISO cutoff server-side.
 *    - `q`      — case-insensitive substring filter on `message`. Empty
 *                 string = no filter. Useful for narrowing on a specific
 *                 throw site without leaving the page.
 *    - `page`   — 1-indexed page. Combines with `per` to compute the
 *                 SQL `range()` window.
 *    - `per`    — page size, capped at 500. Default 25.
 *
 *  Powers [/admin/errors](../../admin/errors/page.tsx). Service-role
 *  client bypasses RLS; the route guard ensures only admins can hit
 *  this endpoint. */

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
  const levelParam = url.searchParams.get("level") ?? "error";
  const sinceParam = url.searchParams.get("since") ?? "24h";
  const q = url.searchParams.get("q")?.trim() ?? "";
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
    .from("error_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * per, page * per - 1);

  // Level filter — strict allowlist so a malformed param can't
  // smuggle SQL through the eq() string.
  if (levelParam === "error" || levelParam === "warning") {
    query = query.eq("level", levelParam);
  }
  // else "all" — no filter

  // Time range. `??` would collapse `since=all` (which deliberately
  // maps to `null`) into the 24h default — use an explicit `in`
  // check so the `all` sentinel survives.
  const sinceMs = sinceParam in RANGES ? RANGES[sinceParam] : RANGES["24h"];
  if (sinceMs !== null && sinceMs !== undefined) {
    const cutoff = new Date(Date.now() - sinceMs).toISOString();
    query = query.gte("created_at", cutoff);
  }

  // Free-text message search via PostgREST's `ilike`. Wrapped in
  // `%…%` for substring matching; PostgreSQL collation handles
  // the case-insensitivity. Empty string = no filter.
  if (q) {
    query = query.ilike("message", `%${q.replace(/[%_]/g, "")}%`);
  }

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    level: levelParam,
    since: sinceParam,
    q,
    page,
    per,
  });
}
