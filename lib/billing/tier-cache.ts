import type { Tier } from "./tiers";

/** Per-device memory of the last tier the server confirmed for the signed-in
 *  user, so an offline Pro user (common for this PWA) keeps their Pro-gated
 *  targets when `/api/billing/usage` can't be reached.
 *
 *  Safety model — the cache can never grant more than the server would:
 *    - it is only ever WRITTEN from a successful server response, so it holds
 *      exactly what the server last said (a downgrade overwrites it at once);
 *    - it is only READ when the live request failed, never in place of a live
 *      answer;
 *    - it is keyed to one user id, so a different account on the same device
 *      never inherits it, and sign-out clears it;
 *    - it only gates client-side views of local data: every server route and
 *      cron re-checks the tier itself.
 *
 *  localStorage can throw (Safari private mode, blocked site data, quota).
 *  A failed read means "no cache" and a failed write means "nothing cached":
 *  both degrade to the pre-cache behaviour (Pro gates off while offline), so
 *  the error is handled by that fallback rather than surfaced. */

const STORAGE_KEY = "maqro:billing:last-known-tier:v1";

const TIERS: ReadonlySet<string> = new Set<Tier>(["free", "plus", "pro"]);

type Entry = { userId: string; tier: Tier };

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    v.userId.length > 0 &&
    typeof v.tier === "string" &&
    TIERS.has(v.tier)
  );
}

/** The last server-confirmed tier for `userId`, or `null` when nothing valid
 *  is cached for that user (or storage is unavailable). */
export function readCachedTier(userId: string): Tier | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable → no cache (see module note)
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt entry → treated as absent; next write replaces it
  }
  return isEntry(parsed) && parsed.userId === userId ? parsed.tier : null;
}

/** Remember the tier the server just confirmed for `userId`. Replaces any
 *  entry for another user. */
export function writeCachedTier(userId: string, tier: Tier): void {
  if (!TIERS.has(tier)) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId, tier } satisfies Entry),
    );
  } catch {
    // Storage unavailable → nothing cached (see module note).
  }
}

/** Forget the cached tier (sign-out, or the server says the session is
 *  gone). */
export function clearCachedTier(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable → there is nothing persisted to clear.
  }
}
