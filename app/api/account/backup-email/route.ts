import { assertFreshAal2 } from "@/lib/auth/mfa-required";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Clear the user's backup email. Wipes both the verified address
 *  and any in-flight pending verification — a single "remove this"
 *  action shouldn't leave a half-pending state that re-appears in
 *  the UI after a page refresh.
 *
 *  No body. Cookie session identifies the user. No BotID gate
 *  because removing your own backup email isn't an abuse vector
 *  (worst case: an attacker with your session removes your
 *  recovery option — but if they have your session they already
 *  own the account). */
export async function DELETE(): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  // Strict AAL2: removing or changing the recovery channel is a
  // classic first-step in account-takeover (lock the legitimate
  // owner out before pivoting). The trusted-device escape hatch
  // would let a temporarily-compromised browser strip the backup
  // address without prompting for TOTP — we require it fresh.
  const gate = await assertFreshAal2(supabase);
  if (!gate.ok) return gate.response;

  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return NextResponse.json(
      { error: "Service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: updErr } = await admin
    .from("profiles")
    .update({
      backup_email: null,
      backup_email_verified_at: null,
      backup_email_pending: null,
      backup_email_code_hash: null,
      backup_email_code_expires_at: null,
    })
    .eq("user_id", user.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
