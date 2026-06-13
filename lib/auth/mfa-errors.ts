/** Map a raw Supabase / auth-js MFA error to plain, actionable copy — the
 *  two-step-verification counterpart of `humanizePasskeyError`.
 *
 *  The SDK surfaces strings like "Invalid TOTP code entered" or "Token has
 *  expired or is invalid" verbatim; shown to a user mid-verification those are
 *  jargon at the worst possible moment. Map the handful of known cases to
 *  human copy and fall back to a generic retry line for anything unknown —
 *  never leak the raw SDK string. */
export function humanizeMfaError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const m = raw.toLowerCase();

  // "Token has expired or is invalid" contains both words — expiry is the more
  // actionable read, so check it first.
  if (m.includes("expired")) {
    return "That code expired. Codes refresh every 30 seconds — enter the current one.";
  }
  if (m.includes("invalid") || m.includes("incorrect") || m.includes("match")) {
    return "That code didn't match. Open your authenticator app and enter the current 6-digit code.";
  }
  if (m.includes("rate") || m.includes("too many")) {
    return "Too many attempts. Wait a moment, then try again.";
  }
  return "We couldn't verify that code. Try again in a moment.";
}
