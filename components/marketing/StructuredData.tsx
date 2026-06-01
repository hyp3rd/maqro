import { getAppUrl } from "@/lib/app-url";

/** schema.org JSON-LD blob for the marketing landing.
 *
 *  Three node types in one graph (Google's preferred form — one
 *  `<script>`, multiple `@type`s linked by `@id`):
 *
 *    - **Organization** — the entity behind the product. Used by
 *      knowledge-graph cards and "About this site" boxes.
 *    - **WebSite** — the site itself. The `publisher` link back to
 *      the Organization is what gives search engines the line "made
 *      by Maqro" without needing a sitelinks search box (which we
 *      skip since we don't have site search).
 *    - **SoftwareApplication** — the app. `applicationCategory` is
 *      a schema.org enum value; `HealthApplication` is the closest
 *      fit. Offers are listed inline so price/cadence shows in
 *      rich results without a separate Product node.
 *
 *  Rendered inside the landing page's server component so the
 *  payload is in the initial HTML — JS-side mutation isn't picked
 *  up by Googlebot's cheap pass.
 *
 *  Prices are duplicated here (free / 5 / 12) from the Pricing
 *  section. We keep them in sync by hand because the prices are
 *  also strings in `app/page.tsx` — there's no canonical
 *  pricing module yet. If we add one, this should read from it. */
export function StructuredData() {
  const base = getAppUrl();
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: "Maqro",
        url: base,
        logo: `${base}/logo-mark.svg`,
        sameAs: ["https://github.com/hyp3rd/maqro"],
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: base,
        name: "Maqro",
        description:
          "Tune your macros, plan your meals, and track your progress. Local-first, no analytics, open source.",
        publisher: { "@id": `${base}/#organization` },
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${base}/#app`,
        name: "Maqro",
        url: base,
        applicationCategory: "HealthApplication",
        operatingSystem: "Web, iOS, Android",
        description:
          "A personal macro calculator, meal planner, and weight-tracking journal. Local-first, offline-ready, open source.",
        publisher: { "@id": `${base}/#organization` },
        offers: [
          {
            "@type": "Offer",
            name: "Free",
            price: "0",
            priceCurrency: "EUR",
            url: `${base}/app`,
          },
          {
            "@type": "Offer",
            name: "Plus",
            price: "5",
            priceCurrency: "EUR",
            url: `${base}/app?upgrade=plus`,
            availability: "https://schema.org/InStock",
          },
          {
            "@type": "Offer",
            name: "Pro",
            price: "12",
            priceCurrency: "EUR",
            url: `${base}/app?upgrade=pro`,
            availability: "https://schema.org/InStock",
          },
        ],
      },
    ],
  };

  // The double-stringify is intentional: the outer `dangerouslySetInnerHTML`
  // expects a string, and we want the JSON-LD itself to be a valid JSON
  // string (no escaping surprises). React would otherwise HTML-escape `<`
  // inside the script tag, which breaks JSON-LD parsing.
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: schema.org JSON-LD must be a literal script body.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
