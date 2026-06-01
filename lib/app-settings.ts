import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { createClient } from "@supabase/supabase-js";

/** Server-side reader/writer for the `app_settings` key/value table
 *  (migration 0040). Each settings read is cached in-memory for 60s
 *  so a routine route call (the support form, e.g.) doesn't make a
 *  Supabase round-trip on every request. Writes invalidate the
 *  affected key so the admin's "edit and immediately test" workflow
 *  doesn't have to wait for the TTL.
 *
 *  Fail-OPEN to the fallback on read errors. The values stored here
 *  are operational defaults (contact inbox address, etc.) — a
 *  Supabase blip shouldn't take down /api/support; we'd rather route
 *  to a stale but-working address than 500 the form. */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: string; fetchedAt: number }>();

function adminClient() {
  const cfg = getSupabaseSecretConfig();
  if (!cfg) return null;
  return createClient(cfg.url, cfg.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Read a setting. Returns `fallback` when the row doesn't exist,
 *  when Supabase isn't configured, or when the read errors. The
 *  caller is expected to pass a sensible fallback — see
 *  `app/api/support/route.ts` for the canonical "ops inbox"
 *  example. */
export async function getSetting(
  key: string,
  fallback: string,
): Promise<string> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.value;

  const admin = adminClient();
  if (!admin) {
    // Don't poison the cache when Supabase is unconfigured (local dev
    // without env) — the route will read the fallback on every call,
    // which is fine for the rare miss path.
    return fallback;
  }
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle<{ value: string }>();
  if (error || !data) {
    // Cache the fallback so a flaky DB doesn't hammer the table on
    // every miss. The TTL takes care of recovery.
    cache.set(key, { value: fallback, fetchedAt: now });
    return fallback;
  }
  cache.set(key, { value: data.value, fetchedAt: now });
  return data.value;
}

/** Admin-only write. The caller (the admin route) is responsible
 *  for the requireAdmin gate; this helper just persists + drops the
 *  cached value so a subsequent read reflects the change without
 *  waiting out the TTL. */
export async function setSetting(opts: {
  key: string;
  value: string;
  updatedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = adminClient();
  if (!admin) return { ok: false, error: "Service-role key not configured." };
  const { error } = await admin
    .from("app_settings")
    .upsert(
      {
        key: opts.key,
        value: opts.value,
        updated_at: new Date().toISOString(),
        updated_by: opts.updatedBy,
      },
      { onConflict: "key" },
    );
  if (error) return { ok: false, error: error.message };
  cache.delete(opts.key);
  return { ok: true };
}

/** Test-only: drop the cache so a unit test can simulate "operator
 *  just edited the value" without waiting out the 60s TTL. */
export function _clearSettingsCacheForTests(): void {
  cache.clear();
}

/** Canonical setting keys. Keeping them as a const enum makes
 *  refactors safe + the admin UI's whitelist obvious. */
export const SETTING_KEYS = { supportInbox: "support_inbox" } as const;

export const SETTING_DEFAULTS: Record<
  (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS],
  string
> = { [SETTING_KEYS.supportInbox]: "support@maqro.app" };
