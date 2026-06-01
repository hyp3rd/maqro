/** VAPID configuration. Two env-driven values plus a subject the
 *  push provider uses to contact us if traffic looks abusive.
 *
 *  Generate the keypair once with:
 *    npx web-push generate-vapid-keys
 *
 *  Set:
 *    NEXT_PUBLIC_VAPID_PUBLIC_KEY  (shipped to the client for
 *                                   PushManager.subscribe)
 *    VAPID_PRIVATE_KEY             (server-only — signs the JWT
 *                                   the push provider verifies)
 *    VAPID_SUBJECT                 (mailto:you@example.com or
 *                                   https://your.site — the push
 *                                   provider's escalation contact)
 *
 *  When VAPID isn't configured, every push-related API returns 503
 *  and the Settings UI hides the toggle. Mirrors the Stripe-not-
 *  configured pattern so a partial deployment doesn't 500. */

export function getVapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Client-readable: just the public key. Returns null when VAPID
 *  isn't configured on this deployment so the UI can disable
 *  push-related controls. */
export function getVapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}
