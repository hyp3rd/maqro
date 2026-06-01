/** Map Supabase passkey error codes + WebAuthn ceremony failures to
 *  user-facing copy that tells them what to DO, not what broke.
 *
 *  The raw messages from `@supabase/auth-js` and the browser's
 *  WebAuthn layer are technical ("The operation either timed out or
 *  was not allowed by the user agent or the platform", "challenge
 *  expired") and read as "something is broken" to a non-developer.
 *
 *  Cases handled:
 *    - User cancelled or closed the OS passkey prompt — the most
 *      common case and the one most people misread as a failure.
 *    - No passkey for this site on this device — the user needs to
 *      sign in with email first, then enroll on this device.
 *    - Feature disabled on the Supabase project — the maintainer
 *      hasn't flipped the toggle yet.
 *    - Challenge expired — the user took too long; ask again.
 *    - `webauthn_credential_exists` during registration — the
 *      authenticator is already enrolled, no-op.
 *  Anything else falls through to the raw message rather than
 *  silently swallowing diagnostic detail.
 *
 *  Used by the login page's Sign-in-with-passkey button and the
 *  Passkeys section in Settings (registration / delete / rename
 *  surface their own errors via this helper). */
export function humanizePasskeyError(err: unknown): string {
  // Null / undefined / a literal `null` from upstream code → generic
  // fallback. Without this `String(null)` becomes the message body,
  // which would print "null" verbatim to the user.
  if (err == null) return "Passkey operation failed. Try again.";
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "The passkey prompt was dismissed. Try again, or use email instead.";
  }
  if (lower.includes("timed out") || lower.includes("not allowed")) {
    return "The passkey prompt was dismissed. Try again, or use email instead.";
  }
  if (
    lower.includes("credential_not_found") ||
    lower.includes("webauthn_credential_not_found")
  ) {
    return "No passkey for this account on this device. Sign in with email, then add a passkey from Settings.";
  }
  if (lower.includes("webauthn_credential_exists")) {
    return "That authenticator is already registered. Use it to sign in instead.";
  }
  if (
    lower.includes("passkey_disabled") ||
    lower.includes("not enabled") ||
    lower.includes("experimental")
  ) {
    return "Passkeys aren't enabled for this project yet.";
  }
  if (lower.includes("challenge_expired") || lower.includes("expired")) {
    return "That took too long. Tap the passkey button again.";
  }
  if (lower.includes("too_many_passkeys")) {
    return "You've hit the passkey limit. Remove one before adding another.";
  }
  return raw || "Passkey operation failed. Try again.";
}
