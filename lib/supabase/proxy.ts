import { recordTraceEvent } from "@/lib/admin-trace";
import {
  isMfaProtectedPath,
  requiresMfaUpgrade,
} from "@/lib/auth/mfa-required";
import { isCurrentDeviceTrusted } from "@/lib/auth/trusted-device";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_CONFIG } from "./env";

/** Refreshes the auth session cookie on every request so it stays valid.
 * Returns a `NextResponse` that has the latest cookies attached - the
 * proxy should return this (or a response built from it). */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  // Always pass the request through; if Supabase isn't configured the
  // app runs in guest mode and there's nothing to refresh.
  let supabaseResponse = NextResponse.next({ request });

  if (!SUPABASE_CONFIG) return supabaseResponse;

  const supabase = createServerClient(
    SUPABASE_CONFIG.url,
    SUPABASE_CONFIG.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          for (const { name, value } of toSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching `getUser()` triggers the SDK to refresh and re-issue cookies
  // when the access token is near expiry. The returned user is also our
  // signal for the trace-capture below - knowing WHO the request belongs
  // to lets the admin-trace mechanism decide whether to log this hit.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // MFA enforcement on protected page paths. Without this guard, a
  // user who completes the email OTP step but doesn't enter their
  // TOTP code (e.g. by tapping back on the MFA challenge screen)
  // would have a valid AAL1 cookie and the protected pages would
  // happily render — a clean second-factor bypass. We close the gap
  // by redirecting AAL1+TOTP sessions back to /login, which detects
  // the half-completed state and renders the TOTP challenge stage
  // directly (without re-requesting the OTP).
  //
  // Scoped to PAGE paths in `PROTECTED_PATH_PREFIXES` — API routes
  // are gated individually and a blanket middleware check would 401
  // public endpoints (/api/share/*, /api/off-*, /api/health, etc.)
  // for users mid-MFA.
  if (user && isMfaProtectedPath(request.nextUrl.pathname)) {
    // Trusted-device escape hatch — if the user has previously
    // checked "Trust this device for 7 days" and the grant hasn't
    // expired, requiresMfaUpgrade short-circuits to needsUpgrade=
    // false before triggering the redirect. The cookie source is
    // the deviceId mirror written by `getOrCreateDeviceId`; the DB
    // row in `mfa_trusted_devices` is the authoritative grant.
    const decision = await requiresMfaUpgrade(supabase, {
      isTrustedDevice: () =>
        isCurrentDeviceTrusted(supabase, user.id, request.cookies),
    });
    if (decision.needsUpgrade) {
      const next = request.nextUrl.pathname + request.nextUrl.search;
      const redirect = new URL("/login", request.url);
      redirect.searchParams.set("mfa", "required");
      redirect.searchParams.set("next", next);
      // Preserve the cookies the SDK just refreshed onto
      // `supabaseResponse` — without this the redirect would land
      // on /login with a stale token and the user would have to
      // sign in from scratch instead of completing MFA.
      const response = NextResponse.redirect(redirect);
      for (const cookie of supabaseResponse.cookies.getAll()) {
        response.cookies.set(cookie);
      }
      return response;
    }
  }

  // Admin-trace auto-capture. When the signed-in caller is flagged
  // (`profiles.traced = true`), every non-trivial API request lands
  // in `trace_events`. The recorder short-circuits cheaply when
  // the user ISN'T traced (cached lookup), so this adds ~zero
  // overhead in the common case.
  //
  // Path filter: only `/api/*`. Page renders aren't useful trace
  // signal (the operator sees those in the user's behaviour
  // already), and middleware fires on every static asset etc.
  //
  // Allowlist exclusion: a few endpoints poll on a schedule and
  // would flood the trace log with no operator value. Skip them.
  if (user) {
    const path = request.nextUrl.pathname;
    if (path.startsWith("/api/") && !isNoisyEndpoint(path)) {
      // Fire-and-forget - we don't await the insert. The request
      // proceeds with no added latency.
      void recordTraceEvent({
        userId: user.id,
        kind: "http",
        method: request.method,
        path,
        ipAddress: ipFromRequest(request),
        userAgent: request.headers.get("user-agent"),
      });
    }
  }

  return supabaseResponse;
}

/** Endpoints the trace log should ignore. These are background-
 *  poll routes where a "this user is alive" entry every N seconds
 *  would drown out the actual signal an operator wants to see. */
const NOISY_ENDPOINTS = new Set([
  "/api/version", // poll for the update banner
  "/api/billing/usage", // AI-usage indicator polls this
  "/api/health", // uptime monitor
]);

function isNoisyEndpoint(path: string): boolean {
  return NOISY_ENDPOINTS.has(path);
}

/** Best-effort caller-IP resolution from the proxy chain. */
function ipFromRequest(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}
