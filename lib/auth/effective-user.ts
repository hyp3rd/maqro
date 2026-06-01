import { requiresMfaUpgrade } from "@/lib/auth/mfa-required";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/** What the rest of the app should treat as "the signed-in user."
 *
 *  We return a *null* `user` when the session exists but is at AAL1
 *  with a verified TOTP factor pending — security-equivalent to not
 *  being signed in for every UI surface that personalizes based on
 *  identity (the landing header, the recipe page's owner badge,
 *  etc.). The raw session stays valid in the cookie so the user can
 *  still complete the MFA challenge; it just isn't surfaced as
 *  "you're in" anywhere until they finish.
 *
 *  `mfaPending` is exposed so callers can render a "complete your
 *  sign-in" nudge without re-running the check themselves. */
export type EffectiveUser = {
  user: User | null;
  /** True iff there's a real session in the cookie but it's at
   *  AAL1 and the user has a verified TOTP factor — i.e. the user
   *  abandoned the MFA stage and we're treating them as
   *  effectively-anonymous until they finish. */
  mfaPending: boolean;
};

/** Server-side accessor. Wraps `supabase.auth.getUser()` with the
 *  AAL-aware filter from [lib/auth/mfa-required.ts](./mfa-required.ts).
 *
 *  Why this exists: the proxy at [lib/supabase/proxy.ts](../supabase/proxy.ts)
 *  redirects AAL1+TOTP-pending requests away from the protected
 *  PAGE paths (`/app*`, `/admin*`). It doesn't redirect requests
 *  to the marketing pages (`/`, `/pricing`, etc.) — they're public
 *  and shouldn't bounce. But those pages STILL render auth-aware
 *  chrome (signed-in email, "Open app" link, admin links) by
 *  calling `getUser()` directly. The fix is to channel those
 *  reads through this helper so the chrome treats the user as
 *  not-signed-in until MFA completes.
 *
 *  Returns `{ user: null, mfaPending: false }` when Supabase isn't
 *  configured (guest-mode deploys) or when getUser fails. */
export async function getEffectiveUser(): Promise<EffectiveUser> {
  const supabase = await getSupabaseServer();
  if (!supabase) return { user: null, mfaPending: false };
  let user: User | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  } catch {
    return { user: null, mfaPending: false };
  }
  if (!user) return { user: null, mfaPending: false };
  const decision = await requiresMfaUpgrade(supabase);
  if (decision.needsUpgrade) {
    return { user: null, mfaPending: true };
  }
  return { user, mfaPending: false };
}
