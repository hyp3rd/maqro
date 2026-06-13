import {
  cacheConfigured,
  cacheDelete,
  cacheGetString,
  cacheSetIfAbsent,
  cacheSetString,
} from "@/lib/cache/redis";
import type { NextRequest, NextResponse } from "next/server";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Coalesce concurrent Supabase session refreshes across requests so a single
 *  reload can't sign the user out.
 *
 *  THE BUG (confirmed against the SDK): every request builds its own per-request
 *  `createServerClient` with no shared lock, so auth-js's in-memory refresh
 *  de-dupe (`refreshingDeferred`) coalesces nothing. Within the last ~90s of the
 *  1h access token, ANY `getUser()` triggers a network refresh; one `/app`
 *  reload fires the page request + many API requests, each refreshing the SAME
 *  single-use refresh token. GoTrue rotates it: the first wins, the rest get
 *  `refresh_token_already_used` → `GoTrueClient._removeSession()` CLEARS the auth
 *  cookies → signed out. A post-deploy update-banner reload synchronizes a whole
 *  cohort into that window → "everyone, every deploy."
 *
 *  THE FIX: within that window, take a short Upstash lock keyed by a HASH of the
 *  refresh token. The winner does the real refresh and publishes the rotated
 *  cookies (AES-256-GCM encrypted) for a few seconds; losers reuse them instead
 *  of racing their own refresh. ALWAYS fail-open — no Redis, no near-expiry
 *  session, a slow/crashed winner, or any error all fall through to a plain
 *  `getUser()` (today's behavior). The lock only engages in the narrow refresh
 *  window, so it's off the hot path for >99% of requests.
 *
 *  Node runtime only (node:crypto + the Upstash REST client). The proxy must not
 *  switch to the edge runtime. */

// Matches auth-js EXPIRY_MARGIN_MS (AUTO_REFRESH_TICK_THRESHOLD 3 ×
// AUTO_REFRESH_TICK_DURATION_MS 30s) — the window in which getUser() refreshes.
const REFRESH_WINDOW_MS = 90_000;
const LOCK_TTL_MS = 5_000;
const RESULT_TTL_MS = 10_000;
const LOSER_POLL_ATTEMPTS = 8;
const LOSER_POLL_INTERVAL_MS = 60;

const AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;
const BASE64_PREFIX = "base64-";

/** Supabase's chunked auth cookie(s): `sb-<ref>-auth-token` + optional `.0/.1`. */
export function isAuthCookieName(name: string): boolean {
  return AUTH_COOKIE_RE.test(name);
}

type Cookie = { name: string; value: string };

/** The subset of a Next `ResponseCookie` we read. A structural supertype (fewer
 *  fields), so `ResponseCookie[]` — which has extra fields like `expires` /
 *  `priority` — is assignable to it without an index-signature mismatch. */
export type ResponseCookieLike = {
  name: string;
  value: string;
  path?: string;
  maxAge?: number;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
};

/** A response cookie sanitized to JSON-safe primitives (no `Date`). */
export type SanitizedCookie = ResponseCookieLike;

function chunkIndex(name: string): number {
  const m = name.match(/\.(\d+)$/);
  // The base cookie (no suffix) sorts before `.0`, `.1`, …
  return m ? Number(m[1]) : -1;
}

/** Read the stored Supabase session straight from the cookies WITHOUT the SDK
 *  (which would trigger a refresh). Reassembles chunked `sb-<ref>-auth-token`
 *  cookies, strips the optional `base64-` prefix, JSON-parses, and pulls
 *  `expires_at` (unix seconds) + `refresh_token`. Returns null on anything
 *  unexpected — the caller falls open to a plain getUser(). */
export function peekSession(
  cookies: Cookie[],
): { expiresAt: number; refreshToken: string } | null {
  try {
    const chunks = cookies.filter((c) => isAuthCookieName(c.name));
    if (chunks.length === 0) return null;
    chunks.sort((a, b) => chunkIndex(a.name) - chunkIndex(b.name));
    let raw = chunks.map((c) => c.value).join("");
    if (raw.startsWith(BASE64_PREFIX)) {
      raw = Buffer.from(raw.slice(BASE64_PREFIX.length), "base64url").toString(
        "utf8",
      );
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const session = parsed as { expires_at?: unknown; refresh_token?: unknown };
    if (
      typeof session.expires_at !== "number" ||
      typeof session.refresh_token !== "string" ||
      session.refresh_token === ""
    ) {
      return null;
    }
    return {
      expiresAt: session.expires_at,
      refreshToken: session.refresh_token,
    };
  } catch {
    return null;
  }
}

/** Stable lock key from a HASH of the refresh token — the raw token is NEVER
 *  written to Redis. Distinct sessions → distinct keys (no false coalescing);
 *  the same session always hashes identically. */
export function refreshLockKey(refreshToken: string): string {
  return (
    "auth:rl:" +
    createHash("sha256").update(refreshToken).digest("hex").slice(0, 32)
  );
}

// --- AES-256-GCM for the cached cookie bundle. Mirrors lib/social/token-crypto
//     but keyed by AUTH_REFRESH_CACHE_SECRET (separate blast radius). ---
function bundleKey(): Buffer | null {
  const secret = process.env.AUTH_REFRESH_CACHE_SECRET;
  if (!secret || secret.length < 32) return null;
  return createHash("sha256").update(secret).digest();
}

export function encryptBundle(plaintext: string): string | null {
  const k = bundleKey();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

export function decryptBundle(envelope: string): string | null {
  const k = bundleKey();
  if (!k) return null;
  try {
    const [ivB, tagB, ctB] = envelope.split(".");
    if (!ivB || !tagB || !ctB) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      k,
      Buffer.from(ivB, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Keep only JSON-safe cookie options (drop `expires` Date / `priority`); the
 *  lifetime is governed by `maxAge`, which @supabase/ssr always sets. */
function sanitizeCookie(c: ResponseCookieLike): SanitizedCookie {
  return {
    name: c.name,
    value: c.value,
    path: c.path,
    maxAge: c.maxAge,
    domain: c.domain,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
  };
}

export type CoalesceDeps = {
  /** Current request cookies (for the peek). */
  readRequestCookies: () => Cookie[];
  /** Run the SDK `getUser()` — refreshes + writes cookies to the response when
   *  near expiry. */
  getUser: () => Promise<{ data: { user: User | null } }>;
  /** The auth cookies currently on the response (after a refresh). */
  readResponseAuthCookies: () => ResponseCookieLike[];
  /** Plant cookies onto BOTH the request (so getUser sees a fresh token) and
   *  the response (so the browser receives the rotated session). */
  plantCookies: (cookies: SanitizedCookie[]) => void;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The coalesced replacement for `supabase.auth.getUser()` in the proxy. */
export async function coalescedGetUser(
  deps: CoalesceDeps,
): Promise<{ data: { user: User | null } }> {
  // Off the hot path unless Redis is configured AND we hold a near-expiry
  // session whose refresh is about to race.
  if (!cacheConfigured()) return deps.getUser();
  const peeked = peekSession(deps.readRequestCookies());
  if (!peeked) return deps.getUser();
  if (peeked.expiresAt * 1000 - Date.now() > REFRESH_WINDOW_MS) {
    return deps.getUser();
  }

  const lockKey = refreshLockKey(peeked.refreshToken);
  const resultKey = `${lockKey}:r`;
  const nonce = randomBytes(8).toString("hex");

  if (await cacheSetIfAbsent(lockKey, nonce, LOCK_TTL_MS)) {
    // Winner: do the real refresh, then publish the rotated cookies for losers.
    const res = await deps.getUser();
    try {
      // Capture the FULL auth-cookie set the SDK wrote — including the empty
      // "delete this stale chunk" cookies a shrinking session emits — so losers
      // replicate the winner's cookie state exactly (no orphaned chunk that
      // would corrupt the next combineChunks).
      const authCookies = deps
        .readResponseAuthCookies()
        .map((c) => sanitizeCookie(c))
        .filter((c) => isAuthCookieName(c.name));
      // Publish ONLY a genuine refresh: a signed-in result AND at least one
      // non-empty token cookie. A sign-out / expiry clears every cookie (all
      // empty) — never replay that to losers, or it would sign them out too.
      const isRealRefresh =
        res.data.user !== null && authCookies.some((c) => c.value !== "");
      if (isRealRefresh) {
        const env = encryptBundle(JSON.stringify(authCookies));
        if (env) await cacheSetString(resultKey, env, RESULT_TTL_MS);
      }
    } catch {
      // Publishing is best-effort; the winner already has its session.
    } finally {
      await cacheDelete(lockKey, nonce); // compare-and-delete: only our lock
    }
    return res;
  }

  // Loser: wait briefly for the winner's published cookies, then reuse them.
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < LOSER_POLL_ATTEMPTS; attempt++) {
    const env = await cacheGetString(resultKey);
    if (env) {
      const json = decryptBundle(env);
      if (json) {
        try {
          const cookies = JSON.parse(json) as SanitizedCookie[];
          deps.plantCookies(cookies);
          // The request now carries a fresh token → getUser() won't refresh.
          return deps.getUser();
        } catch {
          break; // corrupt bundle → fall open
        }
      }
      break; // decrypt failed → fall open
    }
    await sleep(LOSER_POLL_INTERVAL_MS);
  }
  // Winner slow/crashed, or nothing published → fall open (the Supabase
  // reuse-interval setting absorbs this residual race).
  return deps.getUser();
}

/** Wire the proxy's request/response into {@link coalescedGetUser}. Kept here so
 *  the proxy stays a thin caller. `getResponse` returns the LIVE response object
 *  (the proxy reassigns it inside the SDK's `setAll`, so it must be a getter). */
export async function coalescedGetUserForProxy(
  request: NextRequest,
  supabase: SupabaseClient,
  getResponse: () => NextResponse,
): Promise<{ data: { user: User | null } }> {
  return coalescedGetUser({
    readRequestCookies: () =>
      request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
    getUser: () => supabase.auth.getUser(),
    readResponseAuthCookies: () => getResponse().cookies.getAll(),
    plantCookies: (cookies) => {
      const response = getResponse();
      for (const c of cookies) {
        request.cookies.set(c.name, c.value);
        const { name, value, ...options } = c;
        response.cookies.set(name, value, options);
      }
    },
  });
}
