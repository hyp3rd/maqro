/** Shared text-cleanup helpers for recipe import.
 *
 *  The JSON-LD path needs these because publishers routinely stuff
 *  HTML-encoded text into their schema.org JSON (auto-generated
 *  from article bodies without re-encoding), so values like
 *  `Tomato purée &frac34; cup` come through verbatim. The AI path
 *  needs them because the HTML-stripper feeds Claude pre-decoded
 *  text; consistent behaviour between the two paths means the
 *  user sees the same recipe regardless of which extractor ran.
 *
 *  Kept tight on purpose — no full HTML5-entity table, no
 *  duration-localization library. Just the entities and time
 *  shapes that actually show up in recipe data in the wild. */

/** Common HTML entities a recipe publisher might leak into a
 *  JSON-LD string. Hand-curated from a sample of major recipe
 *  sites — the long tail (`&Theta;`, `&clubs;`) doesn't show up,
 *  and the numeric-reference fallback below catches whatever's
 *  outside this set. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  bull: "•",
  middot: "·",
  iexcl: "¡",
  iquest: "¿",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  // Fractions — show up constantly in ingredient quantities.
  frac12: "½",
  frac13: "⅓",
  frac14: "¼",
  frac15: "⅕",
  frac16: "⅙",
  frac18: "⅛",
  frac23: "⅔",
  frac25: "⅖",
  frac34: "¾",
  frac35: "⅗",
  frac38: "⅜",
  frac45: "⅘",
  frac56: "⅚",
  frac58: "⅝",
  frac78: "⅞",
  // Latin accented characters — recipe sites are international and
  // these appear constantly (café, jalapeño, crème brûlée, …).
  // Lookup is done after lowercasing the entity name (see below),
  // so the lowercase form covers both `&eacute;` and `&Eacute;`.
  // Where the unicode case differs, the lowercase form is canonical.
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  yacute: "ý",
  agrave: "à",
  egrave: "è",
  igrave: "ì",
  ograve: "ò",
  ugrave: "ù",
  acirc: "â",
  ecirc: "ê",
  icirc: "î",
  ocirc: "ô",
  ucirc: "û",
  atilde: "ã",
  ntilde: "ñ",
  otilde: "õ",
  auml: "ä",
  euml: "ë",
  iuml: "ï",
  ouml: "ö",
  uuml: "ü",
  yuml: "ÿ",
  aring: "å",
  ccedil: "ç",
  oslash: "ø",
  szlig: "ß",
  aelig: "æ",
  oelig: "œ",
};

/** Decode HTML entities into their unicode equivalents. Handles
 *  the named entities above plus `&#1234;` decimal and `&#xABCD;`
 *  hex numeric references. Unknown named entities are left as-is
 *  so the user can see them and know to file a bug rather than
 *  silently losing data. */
export function decodeHtmlEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s
    .replace(/&#(\d+);/g, (_m, code: string) => safeFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      safeFromCodePoint(parseInt(code, 16)),
    )
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name: string) => {
      const v = NAMED_ENTITIES[name.toLowerCase()];
      return v ?? match;
    });
}

/** Pull a positive integer servings count out of a free-form yield
 *  string. Real-world inputs from JSON-LD and AI extraction:
 *    "4 servings"           → 4
 *    "Serves 4"             → 4
 *    "Makes 12 cookies"     → 12
 *    "2-3 servings"         → 2 (lower bound — we'd rather under-
 *                                portion than over-)
 *    "4 servings (large)"   → 4
 *    "a bowl for one"       → undefined (no integer)
 *
 *  Returns the FIRST positive integer found. Bounded at 100 to
 *  catch obviously-wrong parses (a "1000-piece dim sum" style
 *  number) without legislating reasonable batch-cooking values. */
export function parseServingsCount(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const match = s.match(/\d+/);
  if (!match) return undefined;
  const n = parseInt(match[0], 10);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return undefined;
  return n;
}

/** Convert a time string (ISO 8601 duration OR humanized) into a
 *  total minute count. Symmetric with `formatIsoDuration`: parses
 *  what that one formats, plus a handful of free-form shapes that
 *  publishers actually use in `totalTime`.
 *
 *  Returns undefined if no time is detectable. The caller decides
 *  whether to omit the field or default to 0; we don't make that
 *  policy choice here. */
export function parseTotalTimeToMinutes(
  input: string | undefined,
): number | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  // ISO 8601 duration first — the canonical schema.org shape.
  const iso = trimmed.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const h = iso[1] ? parseInt(iso[1], 10) : 0;
    const m = iso[2] ? parseInt(iso[2], 10) : 0;
    const s = iso[3] ? Math.round(parseFloat(iso[3]) / 60) : 0;
    const total = h * 60 + m + s;
    return total > 0 ? total : undefined;
  }

  // Free-form humanized shapes: "1 hour 30 min", "45 minutes",
  // "About 1 hour", "2 hrs". Walk both unit families with explicit
  // word-boundary anchoring so "1 hour" doesn't accidentally match
  // inside "couple of hours".
  const hoursMatch = trimmed.match(
    /(\d+(?:\.\d+)?)\s*(?:h\b|hr\b|hrs\b|hour|hours)/i,
  );
  const minutesMatch = trimmed.match(
    /(\d+)\s*(?:m\b|min\b|mins\b|minute|minutes)/i,
  );
  // hoursMatch[1] and minutesMatch[1] are always set when the outer
  // match exists (capture group is non-optional), but typescript
  // doesn't know that across the regex-match boundary. Default-
  // through 0 keeps the lint clean without a non-null assertion.
  const hours = hoursMatch?.[1] ? parseFloat(hoursMatch[1]) : 0;
  const minutes = minutesMatch?.[1] ? parseInt(minutesMatch[1], 10) : 0;
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : undefined;
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Humanize an ISO 8601 duration like `PT1H30M` or `PT45M` into
 *  something a recipe reader expects — "1 hour 30 min", "45 min".
 *  Returns the input unchanged if it doesn't look like an ISO
 *  duration so we never lie about format.
 *
 *  schema.org's `totalTime` field is canonically ISO 8601, so this
 *  is the standard recipe-page output. The handful of publishers
 *  who put free-form strings there (Smitten Kitchen, some WordPress
 *  themes) get passed through verbatim. */
export function formatIsoDuration(
  input: string | undefined,
): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  // The duration grammar we care about: PT(H)(M)(S) — date parts
  // (P1D, P1Y) never appear in cooking times. If we don't match,
  // hand the string back as-is rather than silently dropping it.
  const match = trimmed.match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i,
  );
  if (!match) return trimmed;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? Math.round(parseFloat(match[3])) : 0;
  if (hours === 0 && minutes === 0 && seconds === 0) return trimmed;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 && hours === 0 && minutes === 0) {
    parts.push(`${seconds} sec`);
  }
  return parts.join(" ");
}
