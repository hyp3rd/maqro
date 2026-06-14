import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Single-use, short-lived grants that authorize the lost-authenticator
 *  step-down (removing a verified TOTP factor with the service-role key).
 *
 *  The raw token is generated here, returned to the recovery route to embed in
 *  the magic link sent to the user's BACKUP inbox, and never stored — only its
 *  sha256 hash lands in `mfa_recovery_grants`. Redeeming requires presenting the
 *  raw token AND an authenticated session for the same user, so email access
 *  alone can't strip two-step verification (see the migration's SECURITY note).
 *
 *  Service-role client required (RLS blocks everyone else). Fail-closed: any
 *  error resolves to "not authorized" rather than allowing the removal. */

// Matches the magic link's default 1h validity, so the removal path stays
// available for as long as the sign-in link itself works.
const GRANT_TTL_MS = 60 * 60 * 1000;
const TABLE = "mfa_recovery_grants";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint a recovery token for `userId`, persisting ONLY its hash. Returns the raw
 *  token, or null on a write failure so the caller can fail closed (never email
 *  a link whose grant didn't persist). `nowMs` is passed in to keep this pure
 *  and testable. */
export async function createRecoveryGrant(
  admin: SupabaseClient,
  userId: string,
  nowMs: number,
): Promise<string | null> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await admin
    .from(TABLE)
    .insert({
      token_hash: hashToken(token),
      user_id: userId,
      expires_at: new Date(nowMs + GRANT_TTL_MS).toISOString(),
    });
  if (error) return null;
  return token;
}

/** Redeem a recovery token for `userId`. Returns true ONLY when an unexpired,
 *  unconsumed grant exists whose stored hash matches AND whose `user_id` equals
 *  the authenticated caller — then atomically marks it consumed (single-use, so
 *  a leaked link can't be replayed). Fail-closed on any error. */
export async function consumeRecoveryGrant(
  admin: SupabaseClient,
  userId: string,
  token: string,
  nowMs: number,
): Promise<boolean> {
  if (!token) return false;
  const tokenHash = hashToken(token);

  const { data, error } = await admin
    .from(TABLE)
    .select("token_hash, user_id, expires_at, consumed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<{
      token_hash: string;
      user_id: string;
      expires_at: string;
      consumed_at: string | null;
    }>();
  if (error || !data) return false;
  // Constant-time hash compare (defense in depth on top of the eq() match).
  if (!safeEqualHex(data.token_hash, tokenHash)) return false;
  if (data.user_id !== userId) return false;
  if (data.consumed_at) return false;
  if (new Date(data.expires_at).getTime() <= nowMs) return false;

  // Atomically consume: the `is("consumed_at", null)` guard means two
  // simultaneous redeems can't both succeed (only one update matches a row).
  const { data: updated, error: updErr } = await admin
    .from(TABLE)
    .update({ consumed_at: new Date(nowMs).toISOString() })
    .eq("token_hash", tokenHash)
    .is("consumed_at", null)
    .select("token_hash");
  if (updErr || !updated || updated.length === 0) return false;
  return true;
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
