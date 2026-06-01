/** Environmental fingerprint captured at the moment a React hydration
 *  mismatch (#418/#423/#425) is detected.
 *
 *  Why this exists: once the app's own render path is verified
 *  SSR-safe, the remaining cause of an intermittent, prod-only,
 *  un-reproducible hydration mismatch is almost always something
 *  OUTSIDE the app mutating the server HTML before React hydrates —
 *  React's own #418 docs call this out. The two dominant offenders:
 *
 *    1. Browser auto-translation (Chrome/Google Translate, Edge/Bing
 *       Translate). It rewrites text nodes in place, so the client
 *       tree no longer matches the server text → #418. It only kicks
 *       in when the page's `lang` differs from the user's browser
 *       language, which is exactly why it hits some users and not
 *       others and never shows up in a clean test browser.
 *    2. DOM-mutating extensions (Grammarly, Dark Reader, LanguageTool,
 *       …) that inject attributes/elements before hydration.
 *
 *  None of these are reproducible in CI/headless, so the only way to
 *  confirm them is to record the fingerprint from the affected user's
 *  real session. This function reads cheap, already-present DOM signals
 *  and returns a structured verdict the error log can show.
 *
 *  Kept pure (plain inputs, no DOM access) so the classification logic
 *  is unit-testable without a browser; the thin DOM-reading wrapper
 *  lives in [install-error-capture.ts](./install-error-capture.ts). */

export type HydrationEnvironment = {
  /** `<html lang>` as served (the locale React rendered against). */
  htmlLang: string;
  /** `navigator.language` — the browser/OS UI language. */
  navigatorLanguage: string;
  /** True when the page language and the browser language differ at the
   *  primary-subtag level ("en" vs "it"). This is the precondition for
   *  a browser to offer/perform auto-translation, so a mismatch here
   *  alongside a hydration error strongly implicates translation. */
  localeMismatch: boolean;
  /** A page translator has rewritten the DOM (Google/Chrome via the
   *  `translated-ltr`/`translated-rtl` html class; Edge/Bing via the
   *  `_msthash`/`_msttexthash` attributes it stamps on translated
   *  nodes). When true, the hydration mismatch is caused by translation,
   *  not the app. */
  translationActive: boolean;
  /** Names of DOM-mutating browser extensions inferred from the marker
   *  attributes they inject on `<html>`/`<body>` OR the custom elements
   *  they append to `<body>`. Empty when none are detected. */
  extensionSignals: string[];
};

/** Known browser extensions identified by the attributes they inject on
 *  the root/body element before the page's own scripts run. Matched as
 *  case-insensitive prefixes so versioned variants
 *  (`data-darkreader-inline-bgcolor`, …) all collapse to one label. */
const EXTENSION_ATTR_MARKERS: ReadonlyArray<{ prefix: string; name: string }> =
  [
    { prefix: "data-gr-", name: "Grammarly" },
    { prefix: "data-gramm", name: "Grammarly" },
    { prefix: "data-darkreader", name: "Dark Reader" },
    { prefix: "data-lt-", name: "LanguageTool" },
    { prefix: "cz-shortcut-listen", name: "ColorZilla" },
    { prefix: "data-bis_", name: "BIS extension" },
    { prefix: "data-honey-", name: "Honey" },
  ];

/** Password managers and similar extensions don't stamp attributes — they
 *  APPEND a custom element to `<body>` (e.g. ProtonPass's
 *  `<protonpass-root-…>`) before React hydrates, which shifts `<body>`'s
 *  children and is a leading cause of #418 on extension-heavy browsers.
 *  Matched by custom-element tag-name prefix. */
const EXTENSION_ELEMENT_MARKERS: ReadonlyArray<{
  prefix: string;
  name: string;
}> = [
  { prefix: "protonpass-", name: "ProtonPass" },
  { prefix: "com-1password-", name: "1Password" },
  { prefix: "dashlane-", name: "Dashlane" },
  { prefix: "bw-", name: "Bitwarden" },
  { prefix: "lastpass-", name: "LastPass" },
];

/** Primary subtag of a BCP-47 tag, lowercased ("it-IT" → "it"). Empty
 *  string stays empty. */
function primarySubtag(tag: string): string {
  return tag.split("-")[0]?.toLowerCase() ?? "";
}

export type HydrationEnvironmentInput = {
  htmlLang: string;
  htmlClassList: readonly string[];
  htmlAttributeNames: readonly string[];
  bodyAttributeNames: readonly string[];
  /** Tag names of `<body>`'s direct children — used to spot extension
   *  custom elements (ProtonPass, 1Password, …) appended to the body. */
  bodyChildTags: readonly string[];
  navigatorLanguage: string;
};

/** Classify the captured DOM/browser signals into a hydration-cause
 *  verdict. Pure — see module doc for why. */
export function collectHydrationEnvironment(
  input: HydrationEnvironmentInput,
): HydrationEnvironment {
  const htmlLang = input.htmlLang.trim();
  const navigatorLanguage = input.navigatorLanguage.trim();

  const langPrimary = primarySubtag(htmlLang);
  const navPrimary = primarySubtag(navigatorLanguage);
  // Only a mismatch when BOTH sides are known; an empty value means
  // "no signal", which shouldn't read as a conflict.
  const localeMismatch =
    langPrimary !== "" && navPrimary !== "" && langPrimary !== navPrimary;

  // Google/Chrome Translate toggles a direction class on <html>.
  const googleTranslate = input.htmlClassList.some(
    (c) => c === "translated-ltr" || c === "translated-rtl",
  );
  // Edge/Bing Translate stamps `_msthash` / `_msttexthash` on the nodes
  // it rewrites; the markers bubble up onto <html>/<body> often enough
  // to be a reliable tell.
  const allAttrs = [...input.htmlAttributeNames, ...input.bodyAttributeNames];
  const edgeTranslate = allAttrs.some((a) =>
    a.toLowerCase().startsWith("_mst"),
  );
  const translationActive = googleTranslate || edgeTranslate;

  const childTags = input.bodyChildTags.map((t) => t.toLowerCase());
  const extensionSignals = Array.from(
    new Set([
      ...EXTENSION_ATTR_MARKERS.filter(({ prefix }) =>
        allAttrs.some((a) => a.toLowerCase().startsWith(prefix.toLowerCase())),
      ).map(({ name }) => name),
      ...EXTENSION_ELEMENT_MARKERS.filter(({ prefix }) =>
        childTags.some((t) => t.startsWith(prefix.toLowerCase())),
      ).map(({ name }) => name),
    ]),
  );

  return {
    htmlLang,
    navigatorLanguage,
    localeMismatch,
    translationActive,
    extensionSignals,
  };
}
