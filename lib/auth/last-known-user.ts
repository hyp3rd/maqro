/** Per-device record of which account this device's local data belongs to,
 *  so a PWA opened offline after its access token expired keeps showing that
 *  user's own day log and cached tier instead of dropping to guest mode.
 *
 *  Why it exists: offline, with an expired access token, auth-js cannot
 *  refresh the session, and `getSession()` reports `{ session: null }` with
 *  an `AuthRetryableFetchError` (it keeps the stored session and retries the
 *  refresh once the network is back). The identity is then unknown locally,
 *  though nothing says the user signed out.
 *
 *  What it is NOT: a credential. It holds only the user id — no token, no
 *  email, nothing that can authenticate a request. `useUser` reads it only
 *  when the auth server cannot be reached AND no usable session exists, uses
 *  it only if it names the user of the (expired) session auth-js still keeps
 *  in storage — an older bundle may have switched accounts without updating
 *  it — and reports that state as `isOfflineUnverified` with `user: null`,
 *  so sync, AI, billing and account actions (which key off `user`) stay
 *  off. Every server route keeps re-authenticating the request itself.
 *
 *  Lifecycle: written whenever the server verifies a session `useUser`
 *  reports (so an account switch replaces it) — never from a session only
 *  read from storage, resolved offline, or refused; cleared when the server
 *  says the session is gone, on sign-out (`signOutAndClearLocal`), forced
 *  sign-out, account deletion and device reset.
 *
 *  localStorage can throw (Safari private mode, blocked site data, quota).
 *  A failed read means "no record" and a failed write means "nothing
 *  recorded": both degrade to the pre-record behaviour (an expired session
 *  opened offline shows guest mode), so the error is handled by that
 *  fallback rather than surfaced. */

const STORAGE_KEY = "maqro:auth:last-known-user:v1";

type Entry = { userId: string };

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === "string" && v.userId.length > 0;
}

/** The id of the last account seen with a session on this device, or `null`
 *  when nothing valid is recorded (or storage is unavailable). */
export function readLastKnownUserId(): string | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage unavailable → no record (see module note)
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt record → treated as absent; next write replaces it
  }
  return isEntry(parsed) ? parsed.userId : null;
}

/** Record `userId` as this device's account. Replaces any previous one. */
export function writeLastKnownUserId(userId: string): void {
  if (userId.length === 0) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId } satisfies Entry),
    );
  } catch {
    // Storage unavailable → nothing recorded (see module note).
  }
}

/** Forget the record (signed out, or the server rejected the session). */
export function clearLastKnownUser(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable → there is nothing persisted to clear.
  }
}
