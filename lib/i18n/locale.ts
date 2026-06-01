/** Locale resolution for the next-intl single-shot request config.
 *
 *  Two inputs feed the decision, in order of precedence:
 *
 *    1. `NEXT_LOCALE` cookie — set by the LocaleSwitcher when the
 *       user makes an explicit choice. This wins because an
 *       explicit pick is always more trustworthy than a browser
 *       preference.
 *
 *    2. `Accept-Language` header — the user's browser/OS settings.
 *       We parse it leniently: pick the highest-q tag whose primary
 *       subtag we have a `messages/<locale>.json` for, ignoring
 *       region (so "it-IT" maps to "it" since we don't ship a
 *       regional Italian).
 *
 *    3. Fall back to the default ("en") when neither source gives
 *       us a supported locale.
 *
 *  We deliberately don't use `next-intl`'s subpath-routed locale
 *  (`/<locale>/...`) since the app is overwhelmingly used at the
 *  root path (`/app`) and adding `/en/app` everywhere would
 *  invalidate every existing bookmark + shared URL. */

export const SUPPORTED_LOCALES = ["en", "it"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Cookie name. Kept lowercase + standard so any future Next.js
 *  middleware integration recognizes it without configuration. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Type guard. Use this — not a raw string comparison — when narrowing
 *  unknown locale input (cookie value, query param, env var). */
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/** Pick the best supported locale from a cookie value + Accept-Language
 *  header. Both inputs are optional; either being `undefined` means
 *  "no signal from this source", which then falls through to the next.
 *
 *  Exported as a pure function so it can be exhaustively tested
 *  without a request context — the next-intl resolver in
 *  [i18n/request.ts](../../../i18n/request.ts) is a thin wrapper that
 *  just feeds it `cookies()` / `headers()` outputs. */
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | undefined,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  const fromHeader = pickFromAcceptLanguage(acceptLanguage);
  if (fromHeader) return fromHeader;
  return DEFAULT_LOCALE;
}

/** Parse an Accept-Language value and return the highest-q supported
 *  locale, or null when nothing matches. Tolerant of malformed input
 *  (clamps q outside [0,1], drops entries without a primary subtag).
 *
 *  Strips the regional subtag — "it-IT;q=0.9" matches "it" because
 *  we ship one Italian. The same logic will need refining the day we
 *  add (e.g.) `pt-BR` alongside `pt`. */
function pickFromAcceptLanguage(raw: string | undefined): Locale | null {
  if (!raw) return null;
  const entries = raw
    .split(",")
    .map(parseLanguageRange)
    .filter((e): e is { tag: string; q: number } => e !== null)
    .sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    const primary = entry.tag.split("-")[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return null;
}

function parseLanguageRange(raw: string): { tag: string; q: number } | null {
  const [tag, ...params] = raw.trim().split(";");
  if (!tag) return null;
  // Default q=1 when no `q=` parameter is present (HTTP spec). When
  // `q=` IS present but the value is malformed (non-numeric or
  // outside [0,1]), treat the entry as q=0 — never silently upgrade
  // a malformed entry to the spec default. Anything else lets a
  // hostile or buggy Accept-Language header outrank well-formed
  // entries.
  let q = 1;
  for (const p of params) {
    const hasQ = /^\s*q\s*=/i.test(p);
    if (!hasQ) continue;
    const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
    if (!m || !m[1]) {
      q = 0;
      continue;
    }
    const parsed = Number.parseFloat(m[1]);
    q = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
  }
  return { tag: tag.trim(), q };
}
