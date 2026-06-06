/** Curated "shopping markets" for the food-search country bias.
 *
 *  `code` is ISO 3166-1 alpha-2 (used by the device preference + the UI); `offTag`
 *  is the Open Food Facts `countries_tags` taxonomy value the search filters on.
 *  `"world"` = no bias (today's global behaviour). Pure data — imported by both
 *  the client preference (`lib/market.ts`) and the server search
 *  (`lib/ai/off-search.ts`), so it carries no browser/React dependency. */

export type MarketCode =
  | "world"
  | "FR"
  | "DE"
  | "IT"
  | "ES"
  | "GB"
  | "NL"
  | "BE"
  | "PT"
  | "IE"
  | "AT"
  | "CH"
  | "US";

export type Market = {
  code: MarketCode;
  name: string;
  flag: string;
  /** OFF `countries_tags` value, or `null` for "world" (no country bias). */
  offTag: string | null;
};

export const MARKETS: Market[] = [
  { code: "world", name: "Worldwide", flag: "🌍", offTag: null },
  { code: "FR", name: "France", flag: "🇫🇷", offTag: "en:france" },
  { code: "DE", name: "Germany", flag: "🇩🇪", offTag: "en:germany" },
  { code: "IT", name: "Italy", flag: "🇮🇹", offTag: "en:italy" },
  { code: "ES", name: "Spain", flag: "🇪🇸", offTag: "en:spain" },
  {
    code: "GB",
    name: "United Kingdom",
    flag: "🇬🇧",
    offTag: "en:united-kingdom",
  },
  { code: "NL", name: "Netherlands", flag: "🇳🇱", offTag: "en:netherlands" },
  { code: "BE", name: "Belgium", flag: "🇧🇪", offTag: "en:belgium" },
  { code: "PT", name: "Portugal", flag: "🇵🇹", offTag: "en:portugal" },
  { code: "IE", name: "Ireland", flag: "🇮🇪", offTag: "en:ireland" },
  { code: "AT", name: "Austria", flag: "🇦🇹", offTag: "en:austria" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭", offTag: "en:switzerland" },
  { code: "US", name: "United States", flag: "🇺🇸", offTag: "en:united-states" },
];

const BY_CODE = new Map<string, Market>(MARKETS.map((m) => [m.code, m]));

export function isMarketCode(value: string): value is MarketCode {
  return BY_CODE.has(value);
}

/** OFF `countries_tags` value for a market code, or `null` for "world" or any
 *  unknown code (callers treat `null` as "no country bias"). */
export function offCountryTag(code: string): string | null {
  return BY_CODE.get(code)?.offTag ?? null;
}
