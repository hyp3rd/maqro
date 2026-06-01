import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Magic-link landing route. Supabase appends `?code=…` to the redirect
 * URL when the user clicks the email link; this exchanges the code for a
 * session cookie, then sends the user to the app. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Default post-auth destination is the app, not the marketing
  // landing at `/`. A signed-in user wants to use the product.
  const next = url.searchParams.get("next") ?? "/app";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing-code", url));
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login?error=not-configured", url));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url),
    );
  }

  // Defensive: `next` is user-supplied via the OAuth/magic-link
  // request — clamp to the same origin to prevent open-redirect to
  // an attacker-controlled site. Mirrors the `/auth/confirm` guard.
  // An absolute foreign URL (`https://evil.com/...`), a protocol-
  // relative URL (`//evil.com/...`), and opaque schemes like
  // `javascript:` all resolve to a different `origin` and fall
  // through to `/app`.
  const target = new URL(next, url.origin);
  if (target.origin !== url.origin) {
    return NextResponse.redirect(new URL("/app", url));
  }
  return NextResponse.redirect(target);
}
