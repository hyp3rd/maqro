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
 *    - it expires: an entry the server confirmed more than
 *      `TIER_CACHE_MAX_AGE_MS` ago is ignored and dropped, so a device kept
 *      offline cannot keep a lapsed plan's gates open indefinitely;
 *    - it is keyed to one user id, so a different account on the same device
 *      never inherits it; a 401 drops only that user's entry and sign-out
 *      clears it;
 *    - it only gates client-side views of local data: every server route and
 *      cron re-checks the tier itself.
 *
 *  localStorage can throw (Safari private mode, blocked site data, quota).
 *  A failed read means "no cache" and a failed write means "nothing cached":
 *  both degrade to the pre-cache behaviour (Pro gates off while offline), so
 *  the error is handled by that fallback rather than surfaced. */

const STORAGE_KEY = "maqro:billing:last-known-tier:v1";

/** How long a server-confirmed tier may stand in for a failed live request:
 *  30 days, the length of a monthly billing period. */
export const TIER_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const TIERS: ReadonlySet<string> = new Set<Tier>(["free", "plus", "pro"]);

/** `confirmedAt` is the device-clock time (ms) of the server response the
 *  tier came from. */
type Entry = { userId: string; tier: Tier; confirmedAt: number };

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    v.userId.length > 0 &&
    typeof v.tier === "string" &&
    TIERS.has(v.tier) &&
    typeof v.confirmedAt === "number" &&
    Number.isFinite(v.confirmedAt)
  );
}

/** Whether `entry` is still inside its maximum age. A confirmation time in
 *  the future means the device clock moved back since; the entry's age is
 *  then unknown, so it counts as expired. */
function isFresh(entry: Entry, nowMs: number): boolean {
  const ageMs = nowMs - entry.confirmedAt;
  return ageMs >= 0 && ageMs <= TIER_CACHE_MAX_AGE_MS;
}

/** The stored entry, or `null` when nothing usable is stored. Malformed
 *  entries (including ones written before entries carried `confirmedAt`) and
 *  expired ones are dropped, so they can never apply again. */
function readEntry(): Entry | null {
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
    parsed = null; // corrupt entry → treated as absent and dropped below
  }
  if (isEntry(parsed) && isFresh(parsed, Date.now())) return parsed;
  clearCachedTier();
  return null;
}

/** The last server-confirmed tier for `userId`, or `null` when nothing valid
 *  and fresh is cached for that user (or storage is unavailable). */
export function readCachedTier(userId: string): Tier | null {
  const entry = readEntry();
  return entry !== null && entry.userId === userId ? entry.tier : null;
}

/** Remember the tier the server just confirmed for `userId`. Replaces any
 *  entry for another user. */
export function writeCachedTier(userId: string, tier: Tier): void {
  if (!TIERS.has(tier)) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId, tier, confirmedAt: Date.now() } satisfies Entry),
    );
  } catch {
    // Storage unavailable → nothing cached (see module note).
  }
}

/** Forget `userId`'s cached tier (the server no longer vouches for that
 *  session). Another account's entry is left alone. */
export function forgetCachedTier(userId: string): void {
  if (readEntry()?.userId === userId) clearCachedTier();
}

/** Forget the cached tier, whoever it belongs to (sign-out). */
export function clearCachedTier(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable → there is nothing persisted to clear.
  }
}
