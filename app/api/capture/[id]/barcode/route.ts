import { parseBody } from "@/lib/api/parse-body";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ code: z.string() });

/** Phone reports a decoded barcode. Unauthenticated - the session UUID
 *  is the secret, the 5-minute expiry caps the attack window. Service-
 *  role write is necessary because the phone has no Supabase session.
 *
 *  Validates: code is digits-only EAN-8 / UPC-A / EAN-13 / ITF-14 range.
 *  Session must exist, not be expired, and not have already been
 *  filled (one capture per session - re-firing is a no-op). */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return NextResponse.json(
      { error: "Pairing isn't configured (SUPABASE_SECRET_KEY missing)." },
      { status: 503 },
    );
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  // Accept any string and digit-strip - phones can deliver values with
  // stray whitespace (clipboard paste in the manual-entry fallback) or
  // a trailing format suffix. We only care that 8–14 digits come out.
  const code = parsed.data.code.replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) {
    return NextResponse.json(
      { error: "Invalid barcode format." },
      { status: 400 },
    );
  }

  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Validate session is live before writing - avoids leaving stale rows
  // with a barcode set after expiry.
  const { data: row } = await admin
    .from("captures")
    .select("expires_at, kind")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: "Session expired." }, { status: 410 });
  }
  if (row.kind) {
    // Already filled (idempotency / double-submit). Return success
    // anyway - the laptop's poll will read what's there.
    return new NextResponse(null, { status: 204 });
  }

  const { error } = await admin
    .from("captures")
    .update({ kind: "barcode", barcode: code })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
