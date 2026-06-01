import { getAppUrl } from "@/lib/app-url";

/** RFC 9116 security.txt — published at /.well-known/security.txt so
 *  security researchers have a stable place to find responsible-
 *  disclosure contact info without guessing inboxes or filing a
 *  ticket through customer support.
 *
 *  We're a small surface, so the file is minimal: just a contact,
 *  an expiry, the canonical URL, and language hint. The fields are
 *  ordered per the RFC's recommendation (Contact and Expires first;
 *  Canonical near the top for self-reference verification).
 *
 *  Expiry strategy: 1 year from build time. Each deploy refreshes
 *  the expiry, so as long as we ship at least once a year (we will)
 *  the file never goes stale. Hard-coding a date would require a
 *  manual update we'd forget. Computing at request time would mean
 *  the file is never cacheable; computing once at module load means
 *  Next can statically render it and serve from edge cache.
 *
 *  Content type is `text/plain` per the RFC — must be 7-bit ASCII
 *  text, must not redirect, must be served at HTTPS. */

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Module-load timestamp. Set once when the server boots / the route
// module first loads. Refreshes on every deploy via cold-start,
// which is exactly the cadence we want — the file's expiry tracks
// when the deployment was actually shipped.
const EXPIRES = new Date(Date.now() + ONE_YEAR_MS).toISOString();

export const dynamic = "force-static";
export const revalidate = false;

export function GET(): Response {
  const appUrl = getAppUrl();
  const body = [
    "# Maqro security disclosure policy",
    "# https://datatracker.ietf.org/doc/html/rfc9116",
    "",
    "Contact: mailto:security@maqro.app",
    `Expires: ${EXPIRES}`,
    `Canonical: ${appUrl}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
