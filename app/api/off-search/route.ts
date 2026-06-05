import { searchOffHitsServer } from "@/lib/ai/off-search";
import { NextResponse } from "next/server";

/** Server-side proxy to Open Food Facts' Search-a-licious endpoint. Necessary
 * because OFF doesn't send Access-Control-Allow-Origin, so browsers can't fetch
 * it cross-origin. The upstream fetch + the shared cross-instance cache live in
 * `searchOffHitsServer` (shared with the AI planner + enrichment cron); the
 * short edge cache header below still fronts repeat identical requests at the
 * CDN, in front of the route. */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ hits: [] });
  }

  // `searchOffHitsServer` clamps to its own MAX_LIMIT (25); just parse here.
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(requested) ? requested : 10;

  try {
    const hits = await searchOffHitsServer(q, limit);
    return NextResponse.json(
      { hits },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
