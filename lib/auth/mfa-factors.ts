import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolve the id of the user's verified TOTP factor, or `null` when there
 *  isn't one (or the lookup fails).
 *
 *  Swallows errors on purpose: a missing session or a Supabase outage on
 *  `listFactors()` collapses to `null`, which every caller already treats as
 *  "no usable factor" — the login resume leaves its default stage, the in-app
 *  challenge dialog rejects. Centralizing the `listFactors() → find verified
 *  TOTP` lookup keeps the "which factor do we challenge" rule in one place
 *  instead of repeated inline at each browser call site. */
export async function getVerifiedTotpFactorId(
  supabase: SupabaseClient,
): Promise<string | null> {
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    return data?.totp.find((f) => f.status === "verified")?.id ?? null;
  } catch {
    return null;
  }
}
