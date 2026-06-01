/** Centralized access to the Supabase env vars.
 *
 * Supabase's current naming (rolled out late 2024/2025):
 *   - `publishable key` (prefix `sb_publishable_`) — replaces "anon key"
 *   - `secret key` (prefix `sb_secret_`) — replaces "service role key"
 *
 * Old anon JWT tokens (`eyJ...`) still work; the SDK doesn't care about the
 * format. We prefer the new env var name but fall back to the legacy
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` so existing `.env.local` files don't
 * break the moment they pull this change.
 *
 * `SUPABASE_CONFIG` is `null` when env is missing — that's "guest mode"
 * and the rest of the app handles it gracefully. */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIG =
  url && publishableKey ? { url, publishableKey } : null;

export function isSupabaseConfigured(): boolean {
  return SUPABASE_CONFIG !== null;
}

/** Server-only. Reads the service-role secret key — never imported from a
 * client module, since the value bypasses RLS. Returns `null` when the env
 * isn't set so callers (route handlers) can surface a configured-vs-not-
 * configured state instead of crashing. */
export function getSupabaseSecretConfig(): {
  url: string;
  secretKey: string;
} | null {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;
  return { url, secretKey };
}
