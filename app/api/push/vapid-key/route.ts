import { getVapidPublicKey } from "@/lib/push/config";
import { NextResponse } from "next/server";

/** Returns the VAPID public key for the client to pass to
 *  PushManager.subscribe(). Public information by design — the
 *  whole point of the public key is that the browser uses it as
 *  the `applicationServerKey` when registering with the push
 *  provider; an attacker reading it gains nothing.
 *
 *  We could equally inline the key via `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
 *  and skip this route, but the dedicated endpoint:
 *    - lets the UI detect "VAPID not configured" cleanly (response
 *      is 503, not a string-with-no-key),
 *    - keeps the public key out of every page's HTML payload.
 *
 *  Cache-Control: long-lived (`max-age=86400`). The key only changes
 *  if the deployment regenerates VAPID, which forces a re-subscribe
 *  anyway. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { error: "Push notifications aren't configured on this deployment." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { publicKey },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
