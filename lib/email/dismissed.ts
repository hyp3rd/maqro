import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client for the admin-only inbox_dismissed table (RLS-denied to
 *  everyone else). Returns null when the secret key isn't configured. */
function serviceClient(): SupabaseClient | null {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Resend message ids the admin has archived (hidden from the inbox). */
export async function listDismissedEmailIds(): Promise<Set<string>> {
  const admin = serviceClient();
  if (!admin) return new Set();
  const { data } = await admin.from("inbox_dismissed").select("email_id");
  return new Set((data ?? []).map((r) => r.email_id as string));
}

/** Archive (hide) an inbound message. Idempotent on the message id. */
export async function dismissEmail(
  emailId: string,
  byUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = serviceClient();
  if (!admin) return { ok: false, error: "Service-role key not configured." };
  const { error } = await admin
    .from("inbox_dismissed")
    .upsert({ email_id: emailId, dismissed_by: byUserId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Un-archive (restore) a previously-dismissed message — the symmetric
 *  inverse of `dismissEmail`, backing the inbox's Undo affordance. Idempotent:
 *  deleting a non-existent row is a no-op success. */
export async function undismissEmail(
  emailId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = serviceClient();
  if (!admin) return { ok: false, error: "Service-role key not configured." };
  const { error } = await admin
    .from("inbox_dismissed")
    .delete()
    .eq("email_id", emailId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
