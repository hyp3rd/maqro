import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

/** Validates the `Authorization: Bearer <CRON_SECRET>` header that
 *  Vercel cron (or any external scheduler) supplies on every cron
 *  route. Returns `null` when the header is valid — caller proceeds —
 *  or a `NextResponse` to return immediately on failure.
 *
 *  Why this helper exists: a naive `if (header !== expected)` check
 *  in JavaScript short-circuits on the first byte mismatch, so an
 *  attacker scripting the route with progressively-longer prefixes
 *  can recover the secret one byte at a time by timing the rejection.
 *  Hashing both sides to fixed-length sha256 digests and comparing
 *  with `timingSafeEqual` makes the comparison constant-time
 *  regardless of where the mismatch lands.
 *
 *  Hashing also lets `timingSafeEqual` (which throws on unequal-length
 *  inputs) work with caller-supplied headers of any length without
 *  leaking the secret's length through an exception path. */
export function assertCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured." },
      { status: 503 },
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const expectedDigest = createHash("sha256")
    .update(`Bearer ${secret}`)
    .digest();
  const receivedDigest = createHash("sha256").update(authHeader).digest();
  if (!timingSafeEqual(expectedDigest, receivedDigest)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
