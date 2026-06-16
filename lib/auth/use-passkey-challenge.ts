"use client";

import { humanizePasskeyError } from "@/lib/auth/passkey-errors";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useState } from "react";

/** In-app passkey step-up for the MFA dialog: the user taps "use a passkey
 *  instead" of typing a TOTP code, and on success the gated request retries
 *  under the fresh passkey session (which satisfies the AAL2 gate via its
 *  `amr` — see `authenticatedWithPasskey` in lib/auth/mfa-required.ts).
 *
 *  The hard part is SAFETY, not the ceremony. `signInWithPasskey` uses
 *  discoverable credentials and CANNOT be constrained to the current account
 *  (auth-js exposes no allowCredentials / email hint), and it REPLACES the
 *  session. So a *different* account's passkey on the same device could
 *  silently take over — which, mid-step-up, would run the gated action as the
 *  wrong user. The only available guard is to capture the user id BEFORE the
 *  ceremony and compare it AFTER:
 *    - same id      → `onVerified()` (resolve the bus; the retry runs as the
 *                     same user the action was started for)
 *    - different id → `onBail()` (the dialog must reject the bus so the action
 *                     never executes, then sign out + bounce to a clean /login,
 *                     because the session is now the wrong identity)
 *  A ceremony error (cancelled / no credential / expired) leaves the session
 *  untouched, so we just surface it and let the user retry or type the code.
 *
 *  Mirrors `useTotpChallenge`: owns `busy` + `error`, exposes `setError` so the
 *  sibling TOTP control can clear a stale message when this path takes over. */
export function usePasskeyChallenge({
  onVerified,
  onBail,
}: {
  onVerified: () => void | Promise<void>;
  onBail: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("This app isn't set up for sign-in yet.");
      return;
    }
    setError(null);
    setBusy(true);

    // Authoritative (server-validated) id of who is signed in RIGHT NOW.
    const { data: before } = await supabase.auth.getUser();
    const beforeId = before.user?.id ?? null;
    if (!beforeId) {
      setError("Your session expired. Sign in again.");
      setBusy(false);
      return;
    }

    try {
      const { error: e } = await supabase.auth.signInWithPasskey();
      if (e) throw e;
    } catch (e) {
      // The ceremony failed and the session is unchanged — surface and retry.
      setError(humanizePasskeyError(e));
      setBusy(false);
      return;
    }

    // The ceremony succeeded and REPLACED the session. Re-read the authoritative
    // id and compare — this is the sole guard against an account switch.
    const { data: after } = await supabase.auth.getUser();
    const afterId = after.user?.id ?? null;

    if (afterId && afterId === beforeId) {
      // Same user, now passkey-authenticated. Leave `busy` true: the surface
      // unmounts once the bus resolves and the original request retries.
      await onVerified();
      return;
    }

    // Wrong account (or no session). Hand off to the dialog's bail path; keep
    // `busy` true so nothing is interactable while it signs out + navigates.
    await onBail();
  }

  return { run, busy, error, setError };
}
