import {
  hasVerifiedFactor,
  sessionProvedSecondFactor,
} from "@/lib/auth/mfa-policy";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Decision returned by `requiresMfaUpgrade()`. */
export type MfaUpgradeDecision =
  | { needsUpgrade: false }
  | {
      needsUpgrade: true;
      /** `second-factor-pending`: enrolled, the session hasn't proved it yet.
       *  `assurance-unverifiable`: enrolled, but the session's claims could
       *  not be verified (or name another subject) — fail closed. */
      reason: "second-factor-pending" | "assurance-unverifiable";
    };

/** The server-verified user the gate decides on: the object returned by
 *  `supabase.auth.getUser()` (a GoTrue `/user` round-trip), NEVER the user
 *  embedded in the cookie session (`getSession()`, or the no-argument
 *  `mfa.getAuthenticatorAssuranceLevel()` which reads it), because that
 *  copy is client-controlled. */
export type MfaGateUser = Pick<User, "id" | "factors">;

/** Determines whether the caller's session must be promoted before a
 *  protected page renders or a gated route runs. The policy itself lives in
 *  `lib/auth/mfa-policy.ts`:
 *
 *    - No VERIFIED factor on the server-verified `user` => nothing more to
 *      prove; any session passes. No extra network call.
 *    - A verified factor => the session's VERIFIED JWT claims
 *      (`auth.getClaims()`: signature-checked against the project JWKS, or
 *      through GoTrue for symmetric keys) must show `aal2` or a passkey
 *      sign-in.
 *    - A verified factor but claims that can't be verified, or that name a
 *      different subject than `user` => fail CLOSED (upgrade required).
 *
 *  Enrollment comes from `user.factors` — the GoTrue response — and never
 *  from the session object serialized into the auth cookie: a stale or
 *  tampered cookie that drops `user.factors` must not skip the second
 *  factor.
 *
 *  Why this lives in `lib/auth/` and not inside the proxy: the proxy and
 *  every gated API route call it, so the policy stays in one place. */
export async function requiresMfaUpgrade(
  // SupabaseClient<any> because we don't depend on the generated
  // Database type — only the auth namespace, which is the same
  // shape across all client variants. The `any` here is the type
  // parameter Supabase ships with `SupabaseClient`; not a code
  // smell.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  user: MfaGateUser,
): Promise<MfaUpgradeDecision> {
  if (!hasVerifiedFactor(user)) return { needsUpgrade: false };

  let claims: { sub?: unknown; aal?: unknown; amr?: unknown };
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) {
      return { needsUpgrade: true, reason: "assurance-unverifiable" };
    }
    claims = data.claims;
  } catch {
    return { needsUpgrade: true, reason: "assurance-unverifiable" };
  }
  // The claims must describe the account the server just returned —
  // otherwise one user's enrollment would be judged against another
  // session's assurance level.
  if (claims.sub !== user.id) {
    return { needsUpgrade: true, reason: "assurance-unverifiable" };
  }
  if (sessionProvedSecondFactor(claims)) return { needsUpgrade: false };
  return { needsUpgrade: true, reason: "second-factor-pending" };
}

/** API-level companion to the proxy redirect. Use this at the top
 *  of every auth-gated route handler that does anything more
 *  meaningful than read-public-data, so an AAL1 cookie can't reach
 *  the route by being called directly (the proxy only blocks PAGE
 *  navigations to `/app*` and `/admin*` — APIs are individually
 *  gated, and without this helper an attacker with the AAL1 cookie
 *  could still POST to `/api/meal-plan`, `/api/identify-meal`,
 *  `/api/delete-account`, etc.).
 *
 *  Usage at the call site — pass the user `getUser()` just returned:
 *
 *  ```ts
 *  const supabase = await getSupabaseServer();
 *  const { data: { user } } = await supabase.auth.getUser();
 *  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
 *  const gate = await assertAal2(supabase, user);
 *  if (!gate.ok) return gate.response;
 *  // … handler proceeds with a fully-authenticated user
 *  ```
 *
 *  Returns 403 (not 401) on failure because the caller IS
 *  authenticated — they just haven't promoted to the AAL the route
 *  demands. The 401-vs-403 distinction lets clients tell "log in
 *  again" apart from "complete MFA". The error body carries
 *  `kind: 'mfa-required'` so a client can react specifically
 *  (e.g. prompt the user to complete MFA in-app).
 *
 *  Vacuous-true when no MFA is enrolled, so non-MFA users aren't
 *  punished for our checking. */
export async function assertAal2(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  user: MfaGateUser,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const decision = await requiresMfaUpgrade(supabase, user);
  if (!decision.needsUpgrade) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "Confirm it's you with your authenticator app, then try again.",
        kind: "mfa-required",
      },
      { status: 403 },
    ),
  };
}

/** The gate for irreversible / account-takeover-grade operations:
 *
 *  - account deletion
 *  - recovery / backup-email change
 *  - admin access (`requireAdmin`)
 *  - password / primary-email change (when those land)
 *
 *  Today it is exactly `assertAal2(supabase, user)` — there is no
 *  "remembered device" bypass any more (retired with migration 0078). The
 *  separate name marks these call sites so a future relaxation of the
 *  routine gate can never silently reach them. */
export async function assertFreshAal2(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  user: MfaGateUser,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  return assertAal2(supabase, user);
}

/** Path prefixes that require an authenticated AAL2 session. Listed
 *  explicitly (not by negation) so adding a new protected page is
 *  an opt-IN — safer than "everything not in the allowlist".
 *
 *  Public marketing pages, the share endpoints, /login itself, and
 *  every API route are skipped on purpose: APIs do their own auth
 *  + AAL gating per-route, and /login is where the user GOES to
 *  complete the upgrade. Redirecting /login to /login would loop. */
const PROTECTED_PATH_PREFIXES = ["/app", "/admin"] as const;

/** Is this request path one we should enforce AAL2 on? */
export function isMfaProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}
