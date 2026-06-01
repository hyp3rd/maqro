/** Helpers for the "Share today" branded social card.
 *
 *  The card itself is rendered server-side at
 *  `/api/share/today/og` (an Edge `ImageResponse`); this module
 *  owns the URL contract — what params the route accepts, how
 *  values are clamped, and how the public URL is shaped. The
 *  client uses `buildShareBadgeUrl()` to obtain a fetchable PNG
 *  URL; the route uses `parseShareBadgeParams()` to read the same
 *  contract back. Keeping both ends in this one file means the
 *  shape can't drift.
 *
 *  Numbers travel as plain query params for two reasons:
 *    - The image cache key is the URL; deterministic params ↔
 *      deterministic image, so a CDN edge cache works without
 *      vary tricks.
 *    - No DB. No session. No round-trip to record what someone is
 *      sharing. The local-first architecture pushes hard against
 *      any server state on the share path.
 *
 *  We do NOT sign the URL. Anyone can hand-craft a URL with
 *  arbitrary numbers and get a Maqro-branded card back. Reality
 *  check: anyone who wants to fake a macro card can edit any
 *  image — signing the URL only blocks drive-by tinkering, and
 *  there's no server-side ground truth to bind the signature to
 *  anyway (the macros live in the user's browser, not in our DB).
 *  If brand spoofing becomes a real problem, an HMAC over the
 *  params with `process.env.SHARE_BADGE_SECRET` is a 20-line
 *  retrofit — added then, not preemptively. */

export interface ShareBadgeNumbers {
  caloriesCurrent: number;
  caloriesTarget: number;
  proteinCurrent: number;
  proteinTarget: number;
  carbsCurrent: number;
  carbsTarget: number;
  fatCurrent: number;
  fatTarget: number;
}

/** Build the canonical query string that both the OG image route
 *  and the unfurl page accept. The optional `sig` parameter, when
 *  present, gets appended verbatim — the server-side prepare
 *  endpoint signs over the rounded-and-clamped numbers and passes
 *  the sig in here so the two surfaces (the URL printed in HTML
 *  and the URL the OG route verifies) agree byte-for-byte. */
function buildBadgeQuery(numbers: ShareBadgeNumbers, sig?: string): string {
  const params = new URLSearchParams({
    kc: roundParam(numbers.caloriesCurrent),
    kt: roundParam(numbers.caloriesTarget),
    pc: roundParam(numbers.proteinCurrent),
    pt: roundParam(numbers.proteinTarget),
    cc: roundParam(numbers.carbsCurrent),
    ct: roundParam(numbers.carbsTarget),
    fc: roundParam(numbers.fatCurrent),
    ft: roundParam(numbers.fatTarget),
  });
  if (sig) params.set("sig", sig);
  return params.toString();
}

/** Build the public PNG URL the share button fetches.
 *
 *  `origin` MUST be the absolute origin (`https://maqro.app`).
 *  The browser-side caller derives this from `window.location.origin`;
 *  we don't pull it from any env var because the page rendering the
 *  button is necessarily already served from the right origin.
 *
 *  `sig` is the HMAC produced by the prepare endpoint. Required in
 *  prod (when SHARE_BADGE_SECRET is set) — the OG route rejects
 *  unsigned URLs. Omit in dev / self-hosted setups without the
 *  secret. */
export function buildShareBadgeUrl(
  origin: string,
  numbers: ShareBadgeNumbers,
  sig?: string,
): string {
  return `${origin}/api/share/today/og?${buildBadgeQuery(numbers, sig)}`;
}

/** Build the unfurl page URL — the one a user actually shares to
 *  Twitter / iMessage / LinkedIn. Renders an HTML page whose OG
 *  meta tags point at `buildShareBadgeUrl(...)`, so the receiving
 *  platform fetches the page, sees `og:image`, and displays the
 *  branded card inline. */
export function buildShareBadgePageUrl(
  origin: string,
  numbers: ShareBadgeNumbers,
  sig?: string,
): string {
  return `${origin}/share/today?${buildBadgeQuery(numbers, sig)}`;
}

/** Parse + clamp the query params on the server side. Anything
 *  missing, negative, non-numeric, or absurdly large gets coerced
 *  to a safe value so the image always renders something rather
 *  than 500'ing on bad input. Caller-supplied `kt` of 0 is treated
 *  as "no target shown" by the renderer; we don't substitute a
 *  default target because guest users genuinely don't have one. */
export function parseShareBadgeParams(
  search: URLSearchParams,
): ShareBadgeNumbers {
  return {
    caloriesCurrent: clampInt(search.get("kc"), 0, 99_999),
    caloriesTarget: clampInt(search.get("kt"), 0, 99_999),
    proteinCurrent: clampInt(search.get("pc"), 0, 9_999),
    proteinTarget: clampInt(search.get("pt"), 0, 9_999),
    carbsCurrent: clampInt(search.get("cc"), 0, 9_999),
    carbsTarget: clampInt(search.get("ct"), 0, 9_999),
    fatCurrent: clampInt(search.get("fc"), 0, 9_999),
    fatTarget: clampInt(search.get("ft"), 0, 9_999),
  };
}

function roundParam(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(Math.round(n));
}

function clampInt(raw: string | null, min: number, max: number): number {
  if (raw === null) return 0;
  // `Number()` (not `parseInt`) so partial-numeric junk like "1e9999"
  // → Infinity → caught by `isFinite`, not silently truncated to "1".
  // We accept that this also blesses hex notation ("0xff" → 255) and
  // floats ("3.14" → 3); both are clamped by the per-field cap and
  // floored to a non-negative integer, so neither breaks the render.
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
