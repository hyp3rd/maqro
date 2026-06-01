import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/** Email-OTP / magic-link landing route.
 *
 * Supabase's default email template links to
 *   {{ .SiteURL }}/auth/confirm?token_hash=…&type=magiclink&next=…
 * (not /auth/callback — that's only for the OAuth code-exchange flow).
 * We verify the token_hash, which sets the session cookies, then send the
 * user wherever they were headed. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  // Default post-auth destination is the app, not the marketing
  // landing at `/` — see `/auth/callback` for the same rationale.
  const next = url.searchParams.get("next") ?? "/app";

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=missing-token", url));
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login?error=not-configured", url));
  }

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url),
    );
  }

  // Defensive: `next` is user-supplied via the email template's redirect
  // parameter — clamp to the same origin to prevent open-redirect.
  const target = new URL(next, url.origin);
  if (target.origin !== url.origin) {
    return NextResponse.redirect(new URL("/app", url));
  }
  return NextResponse.redirect(target);
}
