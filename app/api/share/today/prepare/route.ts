import { getAppUrl } from "@/lib/app-url";
import {
  buildShareBadgePageUrl,
  buildShareBadgeUrl,
  parseShareBadgeParams,
} from "@/lib/share-badge";
import { isSigningEnabled, signShareBadge } from "@/lib/share-badge-signing";
import { NextResponse, type NextRequest } from "next/server";

/** Prepare a signed share-card URL pair for the client.
 *
 *  The browser sends its current daily totals as query params; we
 *  parse + clamp them through the same `parseShareBadgeParams` the
 *  OG route uses (so what we sign is exactly what the consumer
 *  will verify, no float-rounding drift between the two ends).
 *  When `SHARE_BADGE_SECRET` is set, we HMAC the canonical numbers
 *  and stamp the sig into both returned URLs; when it isn't, the
 *  URLs come back unsigned and the consumers accept them
 *  unconditionally (see [lib/share-badge-signing.ts](../../../../../lib/share-badge-signing.ts)
 *  for the opt-in model).
 *
 *  Why a separate endpoint instead of inline signing in the OG
 *  route: the signing secret can't leave the server. The browser
 *  building `?kc=…&kt=…&sig=…` would either need the secret (which
 *  defeats signing) or call us anyway — so we cut out the
 *  ceremony and make this the one explicit signing surface.
 *
 *  Why GET (not POST): the payload is non-sensitive, fully
 *  representable in the URL, and small (< 200 bytes). Edge
 *  caching is irrelevant here (each user's numbers differ) but
 *  keeping the request shape simple matches `/api/health` and
 *  `/api/version`. */
export const runtime = "edge";
export const dynamic = "force-dynamic";

interface PrepareResponse {
  /** The PNG endpoint — `fetch()` this to get the shareable file. */
  imageUrl: string;
  /** The unfurl page — share THIS in `navigator.share({ url })`
   *  so Twitter / iMessage / LinkedIn render the OG card preview. */
  pageUrl: string;
  /** True when this URL pair was HMAC-signed; false when the
   *  server has no SHARE_BADGE_SECRET configured. Surfaced so the
   *  client can show a "dev mode" hint if useful — currently
   *  ignored by the share button. */
  signed: boolean;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const numbers = parseShareBadgeParams(req.nextUrl.searchParams);
  const origin = getAppUrl();

  const sig = isSigningEnabled() ? await signShareBadge(numbers) : undefined;

  const body: PrepareResponse = {
    imageUrl: buildShareBadgeUrl(origin, numbers, sig),
    pageUrl: buildShareBadgePageUrl(origin, numbers, sig),
    signed: sig !== undefined,
  };

  return NextResponse.json(body, {
    // No cache — each request is per-user and signing is fast,
    // but a CDN that cached this would silently bind one user's
    // signed URL to anyone hitting the same params (unlikely
    // collision, still wrong).
    headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
  });
}
