import type { User } from "@supabase/supabase-js";

/** The single definition of Maqro's second-factor policy, shared by the
 *  server gates (`lib/auth/mfa-required.ts`), the client sync gate
 *  (`lib/auth/session-assurance.ts`) and — in SQL — the RLS helper
 *  `public.session_satisfies_mfa()` (migration 0079). The three MUST agree:
 *  a session the server lets through but RLS rejects would surface as
 *  `42501` denials mid-sync, and the reverse would be a bypass.
 *
 *  Policy: a user with at least one VERIFIED MFA factor must present a
 *  session that proved a second factor — `aal2`, or a passkey sign-in
 *  (see {@link authenticatedWithPasskey}). A user with no verified factor
 *  has nothing more to prove, so any session satisfies the policy.
 *
 *  Pure, no I/O, no `next/*` imports: safe in the browser bundle. */

/** The `amr` method GoTrue stamps on a passkey sign-in. Verified against the
 *  Supabase Auth source (`internal/models/factor.go`: `PasskeyLogin` →
 *  `"passkey"`); GoTrue counts it as a FIRST factor (`IsAAL2Claim` lists only
 *  totp / mfa/phone / mfa/webauthn / mfa/recovery_code), so the session stays
 *  `aal1`. Mirrored by the SQL helper in migration 0079. */
export const PASSKEY_AMR_METHOD = "passkey";

/** Shape of one JWT `amr` entry. auth-js types it as `string[] | AMREntry[]`,
 *  so an entry may be a bare method name OR an `{ method }` object. */
export type AmrEntry = string | { method?: string | null };

/** True when the user has at least one VERIFIED MFA factor of any type —
 *  the same predicate RLS evaluates against `auth.mfa_factors`. Pass only a
 *  user returned by a server round-trip (`auth.getUser()` / `listFactors()`):
 *  the user object embedded in a cookie session is client-controlled. */
export function hasVerifiedFactor(user: Pick<User, "factors">): boolean {
  return (user.factors ?? []).some((f) => f.status === "verified");
}

/** True when the session was established with a passkey. A passkey is
 *  phishing-resistant and multi-factor by construction (possession of the
 *  authenticator + the user-verification gesture), so it meets our
 *  second-factor bar on its own even though Supabase reports it as AAL1. */
export function authenticatedWithPasskey(
  amr: ReadonlyArray<AmrEntry> | null | undefined,
): boolean {
  return (amr ?? []).some((m) => {
    const name = typeof m === "string" ? m : (m?.method ?? "");
    return name.toLowerCase() === PASSKEY_AMR_METHOD;
  });
}

/** Did this session prove a second factor? Takes the JWT claims (`aal`,
 *  `amr`). On the server pass only VERIFIED claims (`auth.getClaims()`). */
export function sessionProvedSecondFactor(claims: {
  aal?: unknown;
  amr?: unknown;
}): boolean {
  if (claims.aal === "aal2") return true;
  return (
    Array.isArray(claims.amr) &&
    authenticatedWithPasskey(claims.amr as ReadonlyArray<AmrEntry>)
  );
}
