import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { createClient } from "@supabase/supabase-js";

/** Admin-managed hostname allowlist for recipe-import.
 *
 *  Optional restrict-mode: an empty allowlist means the only gates
 *  are the SSRF defenses in fetch.ts + safe-agent.ts. A non-empty
 *  allowlist means ONLY listed hostnames (and their subdomains) can
 *  be imported — every other hostname returns a 422 from the route
 *  with a clear "not on the allowlist" message.
 *
 *  Cache: 60 s in-memory. Recipe imports are infrequent enough that
 *  the cache is mostly a courtesy; the practical effect is to keep
 *  a burst of imports from hammering the table. After an admin
 *  edits the list, the new entry propagates within 60 s (or sooner
 *  on a fresh cold-start). */

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  /** Lower-cased hostnames from the table. `null` when the table is
   *  reachable but empty (which means "no restriction"). */
  hostnames: Set<string> | null;
  fetchedAt: number;
};

let cache: CacheEntry | null = null;

export type AllowlistResult =
  { ok: true; mode: "open" | "restricted" } | { ok: false; reason: string };

/** Returns whether the given hostname is permitted under the current
 *  allowlist policy. Hostnames are matched case-insensitively and
 *  with subdomain wildcarding: an entry `example.com` matches
 *  `example.com`, `www.example.com`, and `cooking.blog.example.com`.
 *
 *  When the table is unreachable (Supabase outage, schema drift),
 *  fail-OPEN: we don't lock out the feature on infrastructure error.
 *  Same trade documented for the rate-limit RPC — the alternative
 *  punishes users for our outage, and the upstream SSRF defenses
 *  still apply. */
export async function isHostAllowed(
  hostname: string,
): Promise<AllowlistResult> {
  const set = await loadAllowlist();
  if (set === null) {
    // Either the cache says "table empty" or the load failed open.
    return { ok: true, mode: "open" };
  }
  if (set.size === 0) {
    // Defensive: same as null, but spelled explicitly.
    return { ok: true, mode: "open" };
  }

  const lower = hostname.toLowerCase();
  if (matches(lower, set)) {
    return { ok: true, mode: "restricted" };
  }
  return {
    ok: false,
    reason: `Hostname ${hostname} is not on the recipe-import allowlist.`,
  };
}

/** Subdomain-aware match. An entry `example.com` matches
 *  `example.com` (exact) and `*.example.com` (any subdomain). We
 *  walk the labels of the candidate from least-specific to most-
 *  specific so an attacker can't sneak past with crafted suffixes
 *  like `myexample.com` matching an `example.com` entry. */
function matches(candidate: string, allowed: Set<string>): boolean {
  if (allowed.has(candidate)) return true;
  // Strip leading labels one at a time, checking each suffix.
  let rest = candidate;
  while (true) {
    const dot = rest.indexOf(".");
    if (dot === -1) return false;
    rest = rest.slice(dot + 1);
    if (allowed.has(rest)) return true;
  }
}

/** Returns the set of allowed hostnames, or `null` if the table is
 *  empty (= no restriction). Uses the module-level cache. */
async function loadAllowlist(): Promise<Set<string> | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.hostnames;
  }
  const secret = getSupabaseSecretConfig();
  if (!secret) {
    // Same fail-open posture: no service-role key configured (local
    // dev, broken deploy) means we can't enforce the allowlist, so
    // we treat the situation as "open" rather than blocking the
    // feature entirely.
    cache = { hostnames: null, fetchedAt: now };
    return null;
  }
  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from("recipe_import_host_allowlist")
    .select("hostname");
  if (error || !Array.isArray(data)) {
    // Don't poison the cache on error — let the next request retry.
    return null;
  }
  if (data.length === 0) {
    cache = { hostnames: null, fetchedAt: now };
    return null;
  }
  const set = new Set<string>(
    data.map((row) => String(row.hostname).toLowerCase()),
  );
  cache = { hostnames: set, fetchedAt: now };
  return set;
}

/** Test-only: drop the cached allowlist so a subsequent
 *  `isHostAllowed` call re-fetches. Exported so the integration
 *  tests can simulate "admin just edited the list" between
 *  scenarios without sleeping out the 60 s TTL. */
export function _clearAllowlistCacheForTests(): void {
  cache = null;
}
