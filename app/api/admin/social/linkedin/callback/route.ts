import { adminRedirectGuard } from "@/lib/auth/admin-redirect";
import { connectLinkedIn, STATE_COOKIE } from "@/lib/social/linkedin-auth";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const BACK = "/admin/social";

/** OAuth callback: validate the CSRF state, exchange the code for tokens, and
 *  store them (encrypted, via the service-role client since the table is
 *  RLS-denied). Always redirects back to /admin/social with a status param. */
export async function GET(request: Request): Promise<Response> {
  const gate = await adminRedirectGuard(request, BACK);
  if (gate) return gate;

  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    // Surface LinkedIn's actual reason (e.g. unauthorized_scope_error) rather
    // than a generic "denied" — it's the difference between guessing and fixing.
    const detail = url.searchParams.get("error_description") ?? oauthError;
    return NextResponse.redirect(
      new URL(
        `${BACK}?error=linkedin-oauth&detail=${encodeURIComponent(detail.slice(0, 200))}`,
        request.url,
      ),
    );
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(
      new URL(`${BACK}?error=linkedin-state`, request.url),
    );
  }

  const config = getSupabaseSecretConfig();
  if (!config) {
    return NextResponse.redirect(
      new URL(`${BACK}?error=linkedin-storage`, request.url),
    );
  }
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    await connectLinkedIn(admin, code);
  } catch {
    return NextResponse.redirect(
      new URL(`${BACK}?error=linkedin-exchange`, request.url),
    );
  }
  return NextResponse.redirect(
    new URL(`${BACK}?connected=linkedin`, request.url),
  );
}
