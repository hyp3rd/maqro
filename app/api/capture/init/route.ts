import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import type { CaptureInitResponse } from "@/lib/capture/types";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Create a new pairing session. The laptop calls this, gets back the
 *  session id + expiry, and renders the QR. The actual signed-upload
 *  URL is minted server-side on the phone page render (so refresh
 *  produces a fresh URL) and on the `/photo-done` POST (so the row
 *  knows where the upload landed).
 *
 *  Requires `SUPABASE_SECRET_KEY` so the service-role client can write
 *  to `public.captures` outside of RLS — the unauth phone POSTs
 *  ({barcode, photo-done}) need that path anyway and we keep the
 *  service-role usage centralized. */
export async function POST(): Promise<NextResponse> {
  const cookieClient = await getSupabaseServer();
  if (!cookieClient) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await cookieClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const gate = await assertAal2(
    cookieClient,
    await trustedDeviceOption(cookieClient, user.id),
  );
  if (!gate.ok) return gate.response;

  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Phone pairing isn't configured on this deployment (SUPABASE_SECRET_KEY missing).",
      },
      { status: 503 },
    );
  }

  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from("captures")
    .insert({ user_id: user.id })
    .select("id, expires_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create capture session." },
      { status: 500 },
    );
  }

  const out: CaptureInitResponse = {
    id: data.id as string,
    expiresAt: data.expires_at as string,
  };
  return NextResponse.json(out);
}
