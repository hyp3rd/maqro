/** Helpers for identifying the current browser tab as a "device" in
 *  the user_devices table. Pure data layer - no React, no Supabase
 *  SDK calls. Callers fetch the session externally and hand the
 *  access_token in. */

/** localStorage key for the per-browser stable device id.
 *
 *  Versioned (`:v1`) so we can rotate the format or force every
 *  install to regenerate without breaking existing rows: bump to
 *  `:v2`, the next sign-in writes a fresh UUID under the new key,
 *  the old `user_devices` rows linger until disconnected manually. */
export const DEVICE_ID_KEY = "maqro:device-id:v1";

/** Cookie name mirror of `DEVICE_ID_KEY`. The proxy and API
 *  gates can't read localStorage — only cookies travel with
 *  requests — so we mirror the same UUID into a `Lax`, non-HttpOnly
 *  cookie. Not HttpOnly because: (a) the value is also in
 *  localStorage anyway, so making the cookie unreadable doesn't
 *  raise the bar against XSS, and (b) being readable makes
 *  reconciliation between the two stores debuggable. The cookie's
 *  *meaning* is just "which UUID identifies this browser"; the
 *  authoritative trust grant lives in `mfa_trusted_devices` and is
 *  bound to the user_id, so a stolen cookie alone grants nothing
 *  beyond the device identity. */
export const DEVICE_ID_COOKIE = "maqro_device_id";
const DEVICE_ID_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

/** UUID-v4 shape (8-4-4-4-12 hex chars). We re-validate retrieved
 *  values against this so a corrupted / hand-edited localStorage
 *  entry regenerates cleanly instead of silently sending junk to
 *  the server. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable per-browser device identifier. Generated lazily on first
 *  call and persisted in localStorage so subsequent sign-ins on the
 *  same browser dedup to the same `user_devices` row.
 *
 *  Returns null in non-browser contexts (SSR, server-side imports
 *  of this module). Callers treat null as "skip device registration"
 *  the same way they treat a missing session_id.
 *
 *  Side effect: when running in the browser, mirrors the UUID into
 *  the `DEVICE_ID_COOKIE` so the proxy / API gates can read it on
 *  the next navigation. The cookie write is best-effort — if it
 *  fails (very locked-down embedded webviews), the localStorage
 *  value still works for the client-side UI; the trusted-device
 *  bypass just won't activate server-side until the cookie can be
 *  set. Acceptable degraded mode.
 *
 *  Incognito caveat: localStorage in private/incognito windows is
 *  scoped to the window's lifetime, so each incognito session gets
 *  a fresh ID - correct, since incognito is meant to be ephemeral.
 *
 *  Failure mode: if localStorage throws (Safari blocks it on some
 *  file:// origins, certain embedded webviews), we return null
 *  rather than throwing - the server falls back to its session-id
 *  lookup path for that registration, which still works (just
 *  loses the per-browser dedup until storage works again). */
export function getOrCreateDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing && UUID_RE.test(existing)) {
      writeDeviceIdCookie(existing);
      return existing;
    }
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, fresh);
    writeDeviceIdCookie(fresh);
    return fresh;
  } catch {
    return null;
  }
}

/** Validate + return a deviceId pulled from a cookie source. Used
 *  by the server-side trust check in `proxy.ts` and `assertAal2`.
 *  Returns null on any shape problem so a tampered cookie value
 *  collapses to "no trust" rather than a stack trace. */
export function validateDeviceId(value: string | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function writeDeviceIdCookie(id: string): void {
  if (typeof document === "undefined") return;
  try {
    // Built up piecemeal so it's obvious what each attribute does.
    // `Secure` only sticks on https origins; localhost http works
    // because browsers allow Secure-flagged cookies on localhost.
    const attrs = [
      `${DEVICE_ID_COOKIE}=${id}`,
      "Path=/",
      `Max-Age=${DEVICE_ID_COOKIE_MAX_AGE}`,
      "SameSite=Lax",
      ...(window.location.protocol === "https:" ? ["Secure"] : []),
    ];
    document.cookie = attrs.join("; ");
  } catch {
    // Best-effort. Localstorage value still works for client UI;
    // server-side trusted-device bypass just won't activate.
  }
}

/** Decode the `session_id` claim from a Supabase access-token JWT
 *  without verifying the signature. Verification is unnecessary here
 *  because we're reading our OWN token to identify our own session -
 *  if the token were tampered with, every other Supabase call would
 *  fail anyway. Returns null when the token isn't a parseable JWT
 *  or doesn't carry session_id (very old SDK versions might not).
 *
 *  We need `session_id` rather than the raw refresh token because
 *  refresh tokens rotate; session_id is stable across rotations for
 *  the lifetime of the Supabase auth session, which matches our
 *  notion of a "device login". */
export function sessionIdFromAccessToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    // JWT uses base64url; replace url-safe chars before atob.
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded)) as { session_id?: string };
    return decoded.session_id ?? null;
  } catch {
    return null;
  }
}

/** Browser + OS extracted from a UA. Browser version is the
 *  *major*-only - minor numbers churn weekly and add noise without
 *  helping identification. OS version is the user-facing label
 *  ("14", "11", "17", etc.) when we can parse one; otherwise null
 *  and the caller renders just the OS family. */
export type ParsedUserAgent = {
  browser: string;
  browserVersion: string | null;
  os: string;
  osVersion: string | null;
};

/** Parse a navigator user-agent into a structured pair. Order
 *  matters in the browser detection: Edg/Opera/Brave must come
 *  before Chrome because they all carry the Chrome substring. The
 *  matcher list stays deliberately short - exotic browsers fall back
 *  to "Browser" and the user can rename the row from Settings. */
export function parseUserAgent(userAgent: string): ParsedUserAgent {
  const ua = userAgent || "";

  // ── Browser + version ─────────────────────────────────────────
  let browser = "Browser";
  let browserVersion: string | null = null;
  const edge = /Edg\/(\d+)/.exec(ua);
  const opera = /(?:OPR|Opera)\/(\d+)/.exec(ua);
  const firefox = /Firefox\/(\d+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const safari = /Version\/(\d+)[\d.]*\s+(?:Mobile\/[^\s]+\s+)?Safari/.exec(ua);
  if (edge) {
    browser = "Edge";
    browserVersion = edge[1] ?? null;
  } else if (opera) {
    browser = "Opera";
    browserVersion = opera[1] ?? null;
  } else if (firefox) {
    browser = "Firefox";
    browserVersion = firefox[1] ?? null;
  } else if (chrome) {
    browser = "Chrome";
    browserVersion = chrome[1] ?? null;
  } else if (safari) {
    browser = "Safari";
    browserVersion = safari[1] ?? null;
  }

  // ── OS family + version ───────────────────────────────────────
  let os = "device";
  let osVersion: string | null = null;
  const iosMatch = /OS (\d+)[._](\d+)(?:[._](\d+))? like Mac OS X/.exec(ua);
  const androidMatch = /Android (\d+)(?:\.(\d+))?/.exec(ua);
  const macMatch = /Mac OS X (\d+)[._](\d+)(?:[._](\d+))?/.exec(ua);
  const winMatch = /Windows NT (\d+\.\d+)/.exec(ua);
  if (/iPad|iPhone|iPod/.test(ua)) {
    os = "iOS";
    if (iosMatch?.[1] && iosMatch?.[2]) {
      osVersion = `${iosMatch[1]}.${iosMatch[2]}`;
    }
  } else if (androidMatch) {
    os = "Android";
    osVersion = androidMatch[2]
      ? `${androidMatch[1]}.${androidMatch[2]}`
      : (androidMatch[1] ?? null);
  } else if (macMatch) {
    os = "macOS";
    if (macMatch[1] && macMatch[2]) {
      osVersion = `${macMatch[1]}.${macMatch[2]}`;
    }
  } else if (winMatch) {
    os = "Windows";
    // Windows NT version → marketing name mapping. NT 10.0 covers
    // both Windows 10 and 11 (Microsoft kept the kernel version
    // identical for compat); we render the NT version verbatim
    // since the UA can't distinguish them. NT 11 would be 11; not
    // emitted by any current build but reserved.
    osVersion = winMatch[1] ?? null;
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  }

  return { browser, browserVersion, os, osVersion };
}

/** Derive a short human-friendly label from a navigator user-agent
 *  string. Examples:
 *    - "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/123..."
 *      → "Chrome 123 on macOS 10.15"
 *    - "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) ... Safari"
 *      → "Safari 17 on iOS 17.2"
 *    - "Mozilla/5.0 (Windows NT 10.0; ...) Edg/120"
 *      → "Edge 120 on Windows 10.0" */
export function inferDeviceLabel(userAgent: string): string {
  const { browser, browserVersion, os, osVersion } = parseUserAgent(userAgent);
  const browserPart = browserVersion ? `${browser} ${browserVersion}` : browser;
  const osPart = osVersion ? `${os} ${osVersion}` : os;
  return `${browserPart} on ${osPart}`;
}
