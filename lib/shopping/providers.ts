/** Delivery providers we hand a shopping item off to via a search
 *  deep-link. None of these expose a public consumer-cart API, so this
 *  is the only ToS-safe integration: open the provider pre-filled with a
 *  search for one item; the user adds it and checks out themselves. */
export type ShoppingProvider = "ubereats" | "doordash" | "glovo";

export type ProviderMeta = {
  id: ShoppingProvider;
  label: string;
  /** Tailwind classes for the provider's badge/button accent. */
  accentClass: string;
};

/** UI metadata, ordered for display. */
export const SHOPPING_PROVIDERS: ProviderMeta[] = [
  {
    id: "ubereats",
    label: "Uber Eats",
    accentClass: "text-emerald-700 dark:text-emerald-400",
  },
  {
    id: "doordash",
    label: "DoorDash",
    accentClass: "text-red-700 dark:text-red-400",
  },
  {
    id: "glovo",
    label: "Glovo",
    accentClass: "text-yellow-700 dark:text-yellow-400",
  },
];

/** Build a provider search URL for one item. Best-effort: these are the
 *  providers' public web search entry points and may drift; they open a
 *  search, not a cart. Glovo's search is city-scoped, so we fall back to
 *  its store directory rather than guessing a location. The query is
 *  always `encodeURIComponent`-escaped, so item names with spaces,
 *  ampersands, etc. can't break the URL or inject parameters. */
export function providerSearchUrl(
  provider: ShoppingProvider,
  query: string,
): string {
  const q = encodeURIComponent(query.trim());
  switch (provider) {
    case "ubereats":
      return `https://www.ubereats.com/search?q=${q}`;
    case "doordash":
      return `https://www.doordash.com/search/store/${q}`;
    case "glovo":
      // Glovo has no stable query-string search; its groceries hub is
      // the closest deep-link that works without a known city slug.
      return q
        ? `https://glovoapp.com/search/?q=${q}`
        : "https://glovoapp.com/";
  }
}
