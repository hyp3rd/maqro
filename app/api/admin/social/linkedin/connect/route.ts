import { adminRedirectGuard } from "@/lib/auth/admin-redirect";
import {
  authorizeUrl,
  linkedInOAuthConfigured,
  STATE_COOKIE,
} from "@/lib/social/linkedin-auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

const BACK = "/admin/social";

/** Start the LinkedIn OAuth dance: set a short-lived CSRF state cookie and
 *  redirect the admin to LinkedIn's consent screen. */
export async function GET(request: Request): Promise<Response> {
  const gate = await adminRedirectGuard(request, BACK);
  if (gate) return gate;

  if (!linkedInOAuthConfigured()) {
    return NextResponse.redirect(
      new URL(`${BACK}?error=linkedin-config`, request.url),
    );
  }

  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set({
    name: STATE_COOKIE,
    value: state,
    path: "/",
    maxAge: 600,
    httpOnly: true,
    // lax (not strict) so the cookie survives the top-level redirect back from
    // linkedin.com to the callback.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return NextResponse.redirect(authorizeUrl(state));
}
