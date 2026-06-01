import { getAppUrl } from "@/lib/app-url";
import type { MetadataRoute } from "next";

/** robots.txt for crawlers.
 *
 *  Posture: we **do not** enumerate sensitive paths via `Disallow:`.
 *  Earlier drafts of this file listed `/admin/`, `/api/`, `/auth/`,
 *  etc. — that's the classic robots.txt anti-pattern. Two reasons to
 *  drop it:
 *
 *    1. `Disallow:` is *publicly readable*. It's the first request
 *       any reconnaissance script makes against a target. Listing
 *       "/admin/" advertises that an admin panel exists; listing
 *       "/api/" advertises the API namespace. Honest crawlers don't
 *       need the hint (they only follow links), and hostile crawlers
 *       ignore robots.txt entirely.
 *    2. The actual access boundary lives elsewhere and is stronger:
 *       - `/admin/*` — role check in `app/admin/layout.tsx` + a
 *         `<meta name="robots" content="noindex,nofollow">` set via
 *         `metadata.robots`. Anything that honors robots.txt also
 *         honors noindex; anything that doesn't ignores both.
 *       - `/api/*` — every route has an auth/role/BotID guard.
 *       - `/app/*` — auth middleware bounces unauthenticated callers.
 *       - Vercel BotID (see `app/instrumentation-client.ts`) gates
 *         the abuse-prone POST routes at the edge.
 *
 *  What this file still does: tells well-behaved crawlers that
 *  everything *they should reach* (marketing + legal pages) is fair
 *  game, and points them at the canonical sitemap. */
export default function robots(): MetadataRoute.Robots {
  const base = getAppUrl();
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${base}/sitemap.xml`,
  };
}
