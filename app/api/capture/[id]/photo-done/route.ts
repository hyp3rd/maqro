import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Phone signals "photo uploaded" after a successful PUT to the signed
 *  Storage URL. Marks the capture row so the laptop's poll picks it
 *  up. Unauthenticated for the same reason as the barcode route — the
 *  session UUID is the secret. */
export async function POST(
  _req: Request,
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

  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch the row to know the user_id (drives the Storage path) and
  // to validate liveness.
  const { data: row } = await admin
    .from("captures")
    .select("user_id, expires_at, kind")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: "Session expired." }, { status: 410 });
  }
  if (row.kind) {
    // Already filled — idempotent.
    return new NextResponse(null, { status: 204 });
  }

  const photoPath = `${row.user_id as string}/${id}.jpg`;
  const { error } = await admin
    .from("captures")
    .update({ kind: "photo", photo_path: photoPath })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
