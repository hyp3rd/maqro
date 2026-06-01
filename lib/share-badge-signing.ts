/** HMAC-SHA256 signing for the share-badge URL contract.
 *
 *  The OG image route at `/api/share/today/og` and the unfurl page
 *  at `/share/today` both render Maqro-branded artifacts from
 *  query params. Without signing, anyone can hand-craft a URL with
 *  arbitrary numbers (`?kc=99999&...`) and post a screenshot
 *  claiming impossible macros under the Maqro brand. The HMAC
 *  binds the params to a server-side secret so only URLs produced
 *  by the prepare endpoint render.
 *
 *  Web Crypto (not `node:crypto`) so the same module runs on the
 *  Edge runtime — both the prepare endpoint and the OG/unfurl
 *  consumers live there for latency.
 *
 *  **Opt-in by env.** When `SHARE_BADGE_SECRET` is unset (dev,
 *  self-hosters), signing is disabled wholesale: the prepare
 *  endpoint emits unsigned URLs and the consumers accept them.
 *  When the secret is set (production), the consumers REQUIRE a
 *  valid sig and reject unsigned requests with 403. This avoids
 *  the security hole where prod has the secret set but consumers
 *  silently accept tampered URLs because "sig was optional". */
import { env } from "@/lib/env";
import type { ShareBadgeNumbers } from "@/lib/share-badge";

/** Returns whether URL signing is currently enabled (the env var
 *  is set). Callers use this to decide whether to require a sig
 *  on incoming requests. */
export function isSigningEnabled(): boolean {
  return typeof env.SHARE_BADGE_SECRET === "string";
}

/** Sign a numbers payload. Returns the base64url-encoded HMAC
 *  bytes. Throws if signing isn't enabled — callers should gate
 *  on `isSigningEnabled()` first. */
export async function signShareBadge(
  numbers: ShareBadgeNumbers,
): Promise<string> {
  const secret = env.SHARE_BADGE_SECRET;
  if (!secret) {
    throw new Error(
      "signShareBadge called without SHARE_BADGE_SECRET — gate on isSigningEnabled()",
    );
  }
  return signShareBadgeWithSecret(numbers, secret);
}

/** Verify a sig against a numbers payload. Returns false on
 *  malformed sig, wrong sig, or any internal error — never
 *  throws, so callers can use a single `if (!ok) return 403`
 *  branch. Returns true vacuously when signing is disabled
 *  (the secret is unset) — the caller is responsible for the
 *  "secret-set means sig-required" policy via `isSigningEnabled`. */
export async function verifyShareBadge(
  numbers: ShareBadgeNumbers,
  sig: string,
): Promise<boolean> {
  const secret = env.SHARE_BADGE_SECRET;
  if (!secret) return true;
  return verifyShareBadgeWithSecret(numbers, sig, secret);
}

/** Same as `signShareBadge` but takes the secret directly. Exposed
 *  for tests so they don't have to stub the env module — mirrors
 *  the `validateEnvFor` / `validateEnv` split in [lib/env.ts](./env.ts). */
export async function signShareBadgeWithSecret(
  numbers: ShareBadgeNumbers,
  secret: string,
): Promise<string> {
  const key = await importKey(secret);
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonicalize(numbers)),
  );
  return base64UrlEncode(new Uint8Array(sigBytes));
}

/** Same as `verifyShareBadge` but takes the secret directly.
 *  Never returns vacuous-true; an empty secret here means "verify
 *  with empty key", not "skip verification". The vacuous-true
 *  branch lives in `verifyShareBadge` because that's the
 *  policy decision; this is the crypto. */
export async function verifyShareBadgeWithSecret(
  numbers: ShareBadgeNumbers,
  sig: string,
  secret: string,
): Promise<boolean> {
  if (typeof sig !== "string" || sig.length === 0) return false;
  try {
    const key = await importKey(secret);
    const sigBytes = base64UrlDecode(sig);
    if (!sigBytes) return false;
    return await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(canonicalize(numbers)),
    );
  } catch {
    return false;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Canonical serialization. Pipe-delimited integer string — fixed
 *  order, no JSON whitespace, no number formatting locale to drift
 *  between sign and verify. Changing this format invalidates every
 *  in-flight share URL, so it MUST stay stable forever (or get
 *  versioned via a leading `v1|` prefix the day we need to break
 *  it). */
function canonicalize(numbers: ShareBadgeNumbers): string {
  return [
    "v1",
    numbers.caloriesCurrent,
    numbers.caloriesTarget,
    numbers.proteinCurrent,
    numbers.proteinTarget,
    numbers.carbsCurrent,
    numbers.carbsTarget,
    numbers.fatCurrent,
    numbers.fatTarget,
  ].join("|");
}

/** Standard URL-safe base64 (RFC 4648 §5): `+/` → `-_`, no
 *  padding. Compact, fits cleanly into a query param without
 *  needing percent-encoding. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(s: string): ArrayBuffer | null {
  // Strict reject of anything outside the URL-safe alphabet so
  // a tampered sig fails fast instead of decoding into garbage
  // that happens to pass crypto.subtle.verify (it won't, but
  // we'd rather not even get there with malformed input).
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  try {
    const binary = atob(padded + "=".repeat(pad));
    // Allocate the ArrayBuffer directly (not via Uint8Array's
    // default constructor) so the returned type is strictly
    // `ArrayBuffer` rather than `ArrayBufferLike` — `crypto.subtle`
    // typings under noUncheckedIndexedAccess reject the latter.
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    return buffer;
  } catch {
    return null;
  }
}
