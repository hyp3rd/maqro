import { parseBody } from "@/lib/api/parse-body";
import { findTrustedDeviceRowId } from "@/lib/auth/trusted-device";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({ deviceId: z.string().optional() });

/** POST /api/auth/mfa/trusted-devices/check - "is THIS browser
 *  exempt from the MFA challenge right now?".
 *
 *  Called from `/login` immediately after a successful OTP verify
 *  (session at AAL1) and before the MFA-stage transition. The
 *  client posts its `deviceId` (the localStorage UUID); the server
 *  looks up an unexpired row in `mfa_trusted_devices` for the
 *  caller. If found, also bumps `last_used_at` so the Settings UI
 *  can show "last used 2 hours ago" alongside "trusted 5 days ago".
 *
 *  Returns `{ trusted: boolean }`. Default-deny: any error, missing
 *  session, or missing deviceId resolves to `trusted: false` so a
 *  Supabase outage can NEVER auto-skip MFA. */

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    // Preview / unconfigured env. Default-deny - without Supabase
    // we can't check, so the client must take the MFA path.
    return NextResponse.json({ trusted: false });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ trusted: false }, { status: 401 });
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) {
    // Keep the trusted:false envelope shape this route already
    // promises — clients expect it on every failure path.
    return NextResponse.json({ trusted: false }, { status: 400 });
  }
  const deviceId = parsed.data.deviceId?.trim();
  if (!deviceId) {
    // Missing deviceId - restricted-storage browser or pre-0028
    // client. Force the MFA path.
    return NextResponse.json({ trusted: false });
  }

  // Cookie-session client SELECTs via the `mfa_trusted_devices` owner-read
  // RLS policy. Shared with the proxy / API gate through
  // `findTrustedDeviceRowId` so "what counts as trusted" stays one rule.
  // RLS denial, DB error, or genuinely not trusted all collapse to null →
  // the user takes the MFA path.
  const rowId = await findTrustedDeviceRowId(supabase, user.id, deviceId);
  if (!rowId) {
    return NextResponse.json({ trusted: false });
  }

  // Best-effort bump of `last_used_at`. Failure here doesn't change
  // the trust outcome - the user is still trusted; we just won't
  // refresh the row's "last used" stamp. Don't await/block on it.
  // Service-role only (no RLS UPDATE policy on the table).
  const secret = getSupabaseSecretConfig();
  if (secret) {
    const admin = createClient(secret.url, secret.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    void admin
      .from("mfa_trusted_devices")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", rowId)
      .then(() => {});
  }

  return NextResponse.json({ trusted: true });
}
