import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** GET /api/admin/inbox/outgoing — list admin-sent emails, newest
 *  first. Backed by the `admin_sent_emails` table (migration 0041).
 *
 *  Returns *just* the DB row — the per-email live Resend status
 *  fetch happens at the detail route so we don't fan out N
 *  requests to Resend on every list render. The list shape is
 *  light enough that the operator can scroll a few months back
 *  without pagination; we cap at 200 rows for safety. */

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT))),
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

  const { data, error } = await admin
    .from("admin_sent_emails")
    .select(
      "id, admin_user_id, recipients, subject, in_reply_to, scheduled_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [], limit });
}
