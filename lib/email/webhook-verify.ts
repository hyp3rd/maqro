import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs webhooks with Svix. Verifying it ourselves (rather than pulling
// the svix package) keeps the dep tree minimal — the scheme is a documented
// HMAC-SHA256.
const TOLERANCE_SECONDS = 5 * 60;

/** Verify a Resend (Svix-signed) webhook against `secret` (the `whsec_…` signing
 *  secret). Headers: `svix-id`, `svix-timestamp`, `svix-signature`. The signed
 *  content is `{id}.{timestamp}.{rawBody}`, HMAC-SHA256 with the base64-decoded
 *  secret, base64-encoded. The signature header is a space-separated list of
 *  `v1,<sig>` entries; any timing-safe match passes. */
export function verifyResendWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject stale timestamps (replay protection).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  return signatureHeader.split(" ").some((part) => {
    const sig = part.split(",")[1];
    if (!sig) return false;
    const sigBuf = Buffer.from(sig);
    return (
      sigBuf.length === expectedBuf.length &&
      timingSafeEqual(sigBuf, expectedBuf)
    );
  });
}
