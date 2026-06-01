import { APP_VERSION } from "@/lib/version";
import { NextResponse } from "next/server";

/** Tiny GET endpoint whose only job is to report the version the
 *  *server* is running. Clients compare it to their bundled
 *  [APP_VERSION](../../../lib/version.ts) to detect when a fresh
 *  deploy has shipped while their tab was open — see
 *  [hooks/use-version-check.ts](../../../hooks/use-version-check.ts).
 *
 *  No auth — the version isn't sensitive and we want every client
 *  to be able to poll it, signed-in or not. No DB — the value comes
 *  straight from the build's `package.json`.
 *
 *  Cache-Control: `no-store` is load-bearing. A CDN that holds
 *  this response for even a minute would silently mute the update
 *  prompt for everyone behind that edge during deploys. */
export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { version: APP_VERSION },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
