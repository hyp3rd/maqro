import {
  combineChunks,
  parseCookieHeader,
  stringFromBase64URL,
} from "@supabase/ssr";

/** Reads which user the auth-js session persisted on this device belongs
 *  to, straight from the browser client's cookie storage — expired or not.
 *
 *  Why not the SDK: `getSession()` refreshes an expired access token, and
 *  offline that refresh fails, so it reports no session at all although the
 *  stored one is still there (auth-js keeps it for a refresh once the
 *  network is back). The SDK has no public read of the stored session that
 *  skips the refresh, so this reads the storage the way @supabase/ssr's
 *  browser client writes it (`createStorageFromOptions` in
 *  @supabase/ssr/dist/main/cookies.js):
 *    - storage key: supabase-js's default, `sb-<first label of the project
 *      URL's hostname>-auth-token` (lib/supabase/client.ts sets no custom
 *      `storageKey` / `cookieOptions.name`);
 *    - value: the session JSON, optionally `base64-` + base64url-encoded,
 *      split across `<key>`, or `<key>.0`, `<key>.1`, … cookies.
 *  The round trip is pinned by a test that has the real browser client
 *  store a session and reads it back here.
 *
 *  It only reads an id to compare against; nothing here is used as a
 *  credential. */

const BASE64_PREFIX = "base64-";

/** The cookie key auth-js stores the session under for `supabaseUrl`. */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

function userIdOf(session: unknown): string | null {
  if (typeof session !== "object" || session === null) return null;
  const user = (session as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  const id = (user as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** The user id of the session stored in `cookieHeader` (a `document.cookie`
 *  string) for `supabaseUrl`, or `null` when no session is stored or what
 *  is stored cannot be read as one. A value that can't be decoded or parsed
 *  is what @supabase/ssr itself treats as absent, so it is absent here too. */
export async function storedSessionUserId(
  supabaseUrl: string,
  cookieHeader: string,
): Promise<string | null> {
  const cookies = parseCookieHeader(cookieHeader);
  const stored = await combineChunks(
    authStorageKey(supabaseUrl),
    (name) => cookies.find((c) => c.name === name)?.value ?? null,
  );
  if (stored === null) return null;
  let json = stored;
  if (stored.startsWith(BASE64_PREFIX)) {
    try {
      json = stringFromBase64URL(stored.slice(BASE64_PREFIX.length));
    } catch {
      return null; // undecodable (e.g. chunks from different writes) → absent
    }
  }
  let session: unknown;
  try {
    session = JSON.parse(json);
  } catch {
    return null; // not a session → absent
  }
  return userIdOf(session);
}
