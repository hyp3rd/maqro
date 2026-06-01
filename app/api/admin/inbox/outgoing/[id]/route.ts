import { getOutgoingEmail } from "@/lib/email/sending";
import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** GET /api/admin/inbox/outgoing/[id] — full detail for an admin-
 *  sent email. Composes two reads:
 *
 *    1. The local `admin_sent_emails` row (who sent it, when, in
 *       reply to which inbound, etc.). Authoritative for the
 *       fields we created at send-time.
 *
 *    2. The live Resend `GET /emails/{id}` lookup. Authoritative
 *       for delivery status (queued → sent → delivered, bounced,
 *       complained, etc.) — Resend updates this asynchronously as
 *       the recipient's mail server processes the message.
 *
 *  Both fetches run in parallel. If the live lookup fails (Resend
 *  outage, message older than Resend's retention window, …) we
 *  still return the DB row with `liveStatus: null` so the page
 *  renders something useful instead of a 502. */

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
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

  const [rowRes, liveRes] = await Promise.all([
    admin
      .from("admin_sent_emails")
      .select(
        "id, admin_user_id, recipients, subject, in_reply_to, scheduled_at, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    getOutgoingEmail(id),
  ]);

  if (rowRes.error) {
    return NextResponse.json({ error: rowRes.error.message }, { status: 500 });
  }
  if (!rowRes.data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Resend may report a not-found if the message is too old; the
  // local row is still the canonical record so we surface that
  // rather than 404ing.
  const live = liveRes.ok ? liveRes.email : null;

  return NextResponse.json({ row: rowRes.data, live });
}
