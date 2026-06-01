import type { FoodItem } from "@/components/macro/types";
import type { MealTemplate } from "@/lib/db";

/** Self-contained share format for meal templates. Encodes a
 *  template into a URL fragment that the recipient can decode +
 *  import into their own templates list — no server roundtrip,
 *  no DB row.
 *
 *  Why URL-encoded rather than a recipes-style share-slug:
 *
 *    1. **No infrastructure to ship.** Templates are small enough
 *       (median ~1KB JSON, well under the 2KB practical URL cap)
 *       that an `?data=…` payload fits in even old proxies. No
 *       migration, no API route, no public read surface.
 *
 *    2. **No privacy footprint.** A share-slug would create a
 *       persistent row keyed to the originating user; the URL-
 *       encoded path leaks nothing about the sender. Templates
 *       have no PII either way, but minimizing data at rest
 *       matches the rest of Maqro's "local-first" ethos.
 *
 *    3. **Offline-friendly recipient flow.** Recipient can open
 *       the URL on a plane and still get the import preview —
 *       the data is in the URL itself, served by Maqro's own
 *       cached PWA shell.
 *
 *  Encoding: serialized JSON → UTF-8 bytes → base64url. We use
 *  base64url (RFC 4648 §5) rather than standard base64 so the
 *  payload doesn't contain `+` `/` `=` characters that mangle
 *  inside URLs without further escaping.
 *
 *  Versioned for forward-compat: every payload starts with a
 *  `v: 1` field. A future re-encoding (e.g. msgpack for size) can
 *  ship as `v: 2` without breaking old links that recipients
 *  saved years ago. */

export const SHARE_FORMAT_VERSION = 1 as const;

export type ShareableTemplate = {
  v: typeof SHARE_FORMAT_VERSION;
  /** Template name as the originator saved it. The recipient sees
   *  this in the preview + can rename before import. */
  name: string;
  /** Foods at the portions the originator captured. We keep the
   *  full per-100g `originalValues` block so the imported template
   *  scales correctly on the recipient's planner. */
  foods: FoodItem[];
};

/** Encode a meal template for sharing. Returns the base64url
 *  payload — callers wrap it in their own URL shape (the share
 *  helper below + the page route do this). */
export function encodeTemplateForShare(template: MealTemplate): string {
  const payload: ShareableTemplate = {
    v: SHARE_FORMAT_VERSION,
    name: template.name,
    foods: template.foods,
  };
  const json = JSON.stringify(payload);
  return toBase64Url(json);
}

export type DecodeResult =
  | { ok: true; template: ShareableTemplate }
  | {
      ok: false;
      reason:
        | "malformed-base64"
        | "malformed-json"
        | "wrong-shape"
        | "unsupported-version";
    };

/** Decode + validate a base64url-encoded share payload. Defensive
 *  on every shape because the input is arbitrary user-supplied
 *  text from the URL — a malformed value should produce a clean
 *  rejection, not a crash. */
export function decodeSharedTemplate(payload: string): DecodeResult {
  let json: string;
  try {
    json = fromBase64Url(payload);
  } catch {
    return { ok: false, reason: "malformed-base64" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "malformed-json" };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "wrong-shape" };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== SHARE_FORMAT_VERSION) {
    return { ok: false, reason: "unsupported-version" };
  }
  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    return { ok: false, reason: "wrong-shape" };
  }
  if (!Array.isArray(candidate.foods)) {
    return { ok: false, reason: "wrong-shape" };
  }
  // Light food-shape check: each entry must at least have the
  // numeric macro fields the planner reads. Full type-coverage
  // would re-encode FoodItem here; cheap shape-check + downstream
  // tolerance is the better trade.
  for (const food of candidate.foods) {
    if (!food || typeof food !== "object") {
      return { ok: false, reason: "wrong-shape" };
    }
    const f = food as Record<string, unknown>;
    if (
      typeof f.name !== "string" ||
      typeof f.protein !== "number" ||
      typeof f.carbs !== "number" ||
      typeof f.fat !== "number" ||
      typeof f.calories !== "number" ||
      typeof f.portionSize !== "number"
    ) {
      return { ok: false, reason: "wrong-shape" };
    }
  }
  return {
    ok: true,
    template: {
      v: SHARE_FORMAT_VERSION,
      name: candidate.name,
      foods: candidate.foods as FoodItem[],
    },
  };
}

/** Build the full shareable URL. The payload sits in the URL
 *  fragment (`#data=…`), not the query string, so the request
 *  line the server sees is just `/t/import` — the data never
 *  leaves the client.
 *
 *  Why the hash instead of `?`:
 *
 *    - **Privacy.** Server access logs (Vercel's, any CDN's,
 *      any proxy's) record the path + query but never the
 *      fragment. The shared template's contents stay client-side.
 *    - **No referrer leak.** When the imported template's preview
 *      page navigates onward, the destination's Referer header
 *      strips the fragment automatically — the next request can't
 *      see the payload either.
 *    - **Length budget.** Fragments don't have the same proxy-
 *      level length caps that query strings sometimes hit. */
export function buildShareUrl(template: MealTemplate, baseUrl: string): string {
  const payload = encodeTemplateForShare(template);
  return `${stripTrailingSlash(baseUrl)}/t/import#data=${payload}`;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/** Base64url encode a UTF-8 string. Browser-only (uses `btoa` on
 *  the UTF-8 byte sequence). Wrapped in TextEncoder so non-Latin
 *  template names (e.g. "Frühstücksbowl") round-trip cleanly. */
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Reverse of `toBase64Url`. Throws on malformed input. */
function fromBase64Url(s: string): string {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/");
  // base64 requires length to be a multiple of 4; pad with `=`.
  const padLen = (4 - (padded.length % 4)) % 4;
  const fullyPadded = padded + "=".repeat(padLen);
  const binary =
    typeof atob !== "undefined"
      ? atob(fullyPadded)
      : Buffer.from(fullyPadded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
