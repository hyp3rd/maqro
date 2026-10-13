import type { SupabaseClient } from "@supabase/supabase-js";
import { hasVerifiedFactor, sessionProvedSecondFactor } from "./mfa-policy";

/** Thrown when the signed-in user has two-step verification on but this
 *  session hasn't proved the second factor. Row Level Security rejects such a
 *  session on every user-data table (migration 0079), so the caller must stop
 *  before touching the Data API and get the user through the challenge. */
export class MfaRequiredError extends Error {
  constructor() {
    super("Confirm it's you with your authenticator app to keep syncing.");
    this.name = "MfaRequiredError";
  }
}

/** Client-side mirror of the RLS second-factor rule, checked BEFORE the
 *  browser talks to the Data API (sync pull/push, realtime, device
 *  registration).
 *
 *  Why the client needs it even though RLS is the enforcement: a session the
 *  database rejects doesn't fail loudly everywhere. SELECTs come back EMPTY
 *  (RLS filters, it doesn't error), version-checked UPDATEs and tombstone
 *  DELETEs match zero rows, and INSERTs fail with the same `42501` the sync
 *  engine reads as a cross-user UUID collision (and answers by re-minting
 *  ids). None of that should run against a session that simply owes its
 *  second factor.
 *
 *  - `aal2`, or a passkey sign-in → resolves with no network call (the
 *    session's own access token is decoded locally — this is the client
 *    judging its own session, not an authorization decision).
 *  - Otherwise the factor list comes from `auth.getUser()` — a GoTrue
 *    round-trip, so a factor enrolled from another device since this token
 *    was minted is seen — and a verified factor throws `MfaRequiredError`.
 *  - Anything that can't be determined rejects with the underlying error:
 *    fail closed, the caller retries on its next sync. */
export async function assertDataApiAssurance(
  supabase: SupabaseClient,
): Promise<void> {
  const { data: aal, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) throw aalError;
  if (
    aal &&
    sessionProvedSecondFactor({
      aal: aal.currentLevel,
      amr: aal.currentAuthenticationMethods,
    })
  ) {
    return;
  }
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("No signed-in user to sync for.");
  if (hasVerifiedFactor(user)) throw new MfaRequiredError();
}
