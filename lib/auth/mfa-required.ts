import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Decision returned by `requiresMfaUpgrade()`. */
export type MfaUpgradeDecision =
  | { needsUpgrade: false }
  | { needsUpgrade: true; reason: "aal1-with-totp" };

/** Determines whether the caller's session must be promoted to AAL2
 *  before a protected page renders. The Supabase pattern is:
 *
 *    - AAL1 ("password / OTP only") + has a verified TOTP factor =>
 *      the second factor is still owed; we must redirect to the MFA
 *      challenge before letting them past page chrome.
 *    - AAL1 + no verified TOTP factor => no MFA enrolled, session is
 *      already at its terminal level for this user.
 *    - AAL2 => already promoted, nothing to do.
 *    - Anything else (unknown future levels, errors) => default-DENY
 *      the upgrade requirement. We don't want a transient Supabase
 *      outage to lock out users who genuinely don't have MFA on.
 *
 *  The function is intentionally lenient on errors — a Supabase
 *  outage on `mfa.listFactors()` should fall through to "no upgrade
 *  needed" rather than redirect a non-MFA user into a challenge they
 *  can't complete. The cost of a false negative (one bypass while
 *  the API is down) is far smaller than the cost of a false positive
 *  (entire user base locked out).
 *
 *  Why this lives in `lib/auth/` and not inside the proxy: we want
 *  to call the same check from API route handlers too (each one
 *  decides whether AAL2 is required for its endpoint), and a shared
 *  helper keeps the policy in one place. */
/** Options accepted by both `requiresMfaUpgrade` and `assertAal2`.
 *
 *  `isTrustedDevice` is the trust-this-device escape hatch: when
 *  the AAL1+verified-TOTP case would otherwise demand an upgrade,
 *  the caller can supply a predicate that resolves to `true` for
 *  browsers carrying an unexpired `mfa_trusted_devices` grant. The
 *  predicate is only invoked on the narrow code path where it
 *  matters (AAL1, MFA enrolled, would-redirect) so the DB read is
 *  paid only when relevant. */
export interface MfaUpgradeOptions {
  isTrustedDevice?: () => Promise<boolean>;
}

export async function requiresMfaUpgrade(
  // SupabaseClient<any> because we don't depend on the generated
  // Database type — only the auth namespace, which is the same
  // shape across all client variants. The `any` here is the type
  // parameter Supabase ships with `SupabaseClient`; not a code
  // smell.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  opts: MfaUpgradeOptions = {},
): Promise<MfaUpgradeDecision> {
  // `getAuthenticatorAssuranceLevel` reads the JWT claims locally;
  // no network call. So we can run this on every request without
  // adding a round-trip.
  let aal: { currentLevel?: string | null; nextLevel?: string | null } | null =
    null;
  try {
    const resp = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    aal = resp.data ?? null;
  } catch {
    // Token unreadable / malformed — treat as no-upgrade-needed.
    return { needsUpgrade: false };
  }
  if (!aal) return { needsUpgrade: false };

  // Already at AAL2 → done.
  if (aal.currentLevel === "aal2") return { needsUpgrade: false };
  // Not even at AAL1 → user isn't really signed in; the caller's
  // existing auth check handles this case.
  if (aal.currentLevel !== "aal1") return { needsUpgrade: false };
  // AAL1 but the JWT also says there's no AAL2 available → the
  // user has no MFA enrolled. Session is at its terminal level.
  if (aal.nextLevel !== "aal2") return { needsUpgrade: false };

  // AAL1 with AAL2 available. Only LIST factors at this point —
  // every other case short-circuited above so listFactors only
  // runs for users who actually have it enrolled. This is one API
  // call per request for MFA-enrolled users at AAL1 (i.e. the
  // narrow window between OTP verification and TOTP challenge).
  try {
    const factorsResp = await supabase.auth.mfa.listFactors();
    const hasVerifiedTotp = factorsResp.data?.totp?.some(
      (f) => f.status === "verified",
    );
    if (hasVerifiedTotp) {
      // Trusted-device escape hatch. The DB row in
      // `mfa_trusted_devices` is authoritative; the deviceId cookie
      // just identifies WHICH device. When the caller supplies a
      // check and it resolves true, the user has previously checked
      // "Trust this device for 7 days" and that window hasn't
      // expired — skip the upgrade requirement. Failure / missing
      // check resolves to needsUpgrade (default-deny).
      if (opts.isTrustedDevice) {
        try {
          if (await opts.isTrustedDevice()) {
            return { needsUpgrade: false };
          }
        } catch {
          // Trust check threw — be strict, demand the upgrade.
        }
      }
      return { needsUpgrade: true, reason: "aal1-with-totp" };
    }
  } catch {
    // listFactors failed — be lenient. Same rationale as the AAL
    // try/catch above.
  }
  return { needsUpgrade: false };
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
 *  Usage at the call site:
 *
 *  ```ts
 *  const supabase = await getSupabaseServer();
 *  const { data: { user } } = await supabase.auth.getUser();
 *  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
 *  const gate = await assertAal2(supabase);
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
 *  Vacuous-true when no MFA is enrolled — same lenient policy the
 *  proxy uses, so non-MFA users aren't punished for our checking. */
export async function assertAal2(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  opts: MfaUpgradeOptions = {},
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const decision = await requiresMfaUpgrade(supabase, opts);
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

/** Strict-AAL2 gate that intentionally ignores the trusted-device
 *  escape hatch. Use this in place of `assertAal2(..., trustedDeviceOption(...))`
 *  for operations where a temporarily-compromised trusted device must
 *  not be allowed to escalate to account takeover:
 *
 *  - account deletion
 *  - recovery / backup-email change
 *  - role grant
 *  - password / primary-email change (when those land)
 *
 *  The trusted-device grant ("don't ask me for TOTP again on this
 *  browser for 7 days") is fine for routine reads and most mutations —
 *  it's a convenience tradeoff. For irreversible ops, the second factor
 *  must be presented fresh. A stolen-laptop / shoulder-surf / unlocked-
 *  device scenario shouldn't let an attacker delete the account or
 *  swap the recovery email without re-entering the TOTP code.
 *
 *  Behaviorally equivalent to `assertAal2(supabase)` with no options —
 *  the named helper makes the intent explicit at the route site and
 *  prevents a future refactor from reflexively threading the trust
 *  option back in. */
export async function assertFreshAal2(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  return assertAal2(supabase);
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
