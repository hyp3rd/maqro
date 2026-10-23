import type { Tier } from "./tiers";

/** Per-device memory of the last tier the server confirmed for each of the
 *  few most recent accounts on this device, so an offline Pro user (common
 *  for this PWA) keeps their Pro-gated targets when `/api/billing/usage`
 *  can't be reached — also after another account used the device in
 *  between (A → B → A keeps A's tier).
 *
 *  Safety model — the cache can never grant more than the server would:
 *    - it is only ever WRITTEN from a successful server response, so each
 *      entry holds exactly what the server last said for that user (a
 *      downgrade overwrites it at once);
 *    - it is only READ when the live request failed, never in place of a live
 *      answer;
 *    - every entry expires on its own: one the server confirmed more than
 *      `TIER_CACHE_MAX_AGE_MS` ago is ignored and dropped, so a device kept
 *      offline cannot keep a lapsed plan's gates open indefinitely;
 *    - every entry is keyed to one user id, so a different account on the
 *      same device never inherits it; a 401 drops only that user's entry and
 *      sign-out drops the signed-out user's (lib/auth/sign-out.ts);
 *    - it holds at most `MAX_CACHED_USERS` entries, the most recently
 *      confirmed ones;
 *    - it only gates client-side views of local data: every server route and
 *      cron re-checks the tier itself.
 *
 *  Storage format: a JSON array of entries, most recently confirmed last. A
 *  single entry object (what earlier versions wrote under the same key) reads
 *  as a one-entry list, and an earlier bundle that finds an array drops it
 *  as malformed, so mixed versions degrade to "nothing cached" rather than to
 *  a wrong tier.
 *
 *  localStorage can throw (Safari private mode, blocked site data, quota).
 *  A failed read means "no cache" and a failed write means "nothing cached":
 *  both degrade to the pre-cache behaviour (Pro gates off while offline), so
 *  the error is handled by that fallback rather than surfaced. */

const STORAGE_KEY = "maqro:billing:last-known-tier:v1";

/** How long a server-confirmed tier may stand in for a failed live request:
 *  30 days, the length of a monthly billing period. */
export const TIER_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How many accounts' tiers one device remembers (the most recently
 *  confirmed ones). */
export const MAX_CACHED_USERS = 3;

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

/** The stored items: the array, or a legacy single entry as a one-item
 *  list. Unparseable JSON yields one invalid item, so the caller drops it. */
function parseStored(raw: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null; // corrupt → an invalid item, dropped by the caller
  }
  return Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
}

/** Persist `entries`, or remove the key when there are none. */
function writeEntries(entries: Entry[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable → nothing cached (see module note).
  }
}

/** The valid, fresh entries, oldest first. Malformed entries (including
 *  ones written before entries carried `confirmedAt`) and expired ones are
 *  dropped from storage, so they can never apply again. */
function readEntries(): Entry[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return []; // storage unavailable → no cache (see module note)
  }
  if (raw === null) return [];
  const stored = parseStored(raw);
  const nowMs = Date.now();
  const entries = stored.filter(
    (item): item is Entry => isEntry(item) && isFresh(item, nowMs),
  );
  if (entries.length !== stored.length) writeEntries(entries);
  return entries;
}

/** The last server-confirmed tier for `userId`, or `null` when nothing valid
 *  and fresh is cached for that user (or storage is unavailable). */
export function readCachedTier(userId: string): Tier | null {
  return readEntries().find((e) => e.userId === userId)?.tier ?? null;
}

/** Remember the tier the server just confirmed for `userId`, replacing that
 *  user's previous entry. Other users' entries are kept, up to the
 *  `MAX_CACHED_USERS` most recently confirmed in all. */
export function writeCachedTier(userId: string, tier: Tier): void {
  if (userId.length === 0 || !TIERS.has(tier)) return;
  const others = readEntries().filter((e) => e.userId !== userId);
  const entry: Entry = { userId, tier, confirmedAt: Date.now() };
  writeEntries([...others, entry].slice(-MAX_CACHED_USERS));
}

/** Forget `userId`'s cached tier (the server no longer vouches for that
 *  session, or that user signed out). Other accounts' entries are left
 *  alone. */
export function forgetCachedTier(userId: string): void {
  const entries = readEntries();
  const kept = entries.filter((e) => e.userId !== userId);
  if (kept.length !== entries.length) writeEntries(kept);
}

/** Forget every cached tier, whoever it belongs to (device reset, or a
 *  sign-out whose account is unknown). */
export function clearCachedTier(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable → there is nothing persisted to clear.
  }
}
