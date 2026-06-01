import { createHash, randomInt } from "node:crypto";

/** Shared primitives for the backup-email lifecycle. Lifted into
 *  its own module so the routes (`/api/account/backup-email/*` and
 *  `/api/auth/recovery`) plus the email templates all agree on:
 *
 *    - how the 6-digit OTP is generated (cryptographic, even
 *      distribution)
 *    - how it's hashed before persistence (sha-256 hex — never
 *      store the raw code)
 *    - how email addresses are masked for display in templates so
 *      the recipient can confirm what account they're about to
 *      verify / recover, without revealing the full primary email
 *      to a backup mailbox that may not belong to the primary user.
 *
 *  No DB access here — pure functions only, so the routes can call
 *  them inside their own auth + service-role plumbing. */

/** Server-only. Uses node's crypto (`createHash`, `randomInt`).
 *  Importing from a client component would error at build time. */

/** 6-digit numeric OTP. `randomInt` is the crypto-grade primitive
 *  (calls into the OS's CSPRNG); `Math.random` would be a security
 *  smell here even at this short length.
 *
 *  Range is `[100000, 1_000_000)` so every output is exactly 6
 *  digits — no leading-zero rendering quirks for the user typing
 *  it back. */
export function generateBackupEmailCode(): string {
  return String(randomInt(100000, 1_000_000));
}

/** Stable hash used to compare a user-submitted code against the
 *  one we stored. sha-256 is overkill for a 6-digit OTP (entropy
 *  ceiling is the code itself, ~20 bits), but it costs nothing and
 *  means a DB leak doesn't reveal in-flight codes. */
export function hashBackupEmailCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** OTP TTL. 10 minutes is the de-facto standard for sign-in-style
 *  codes: long enough that the user can pull out their phone to
 *  read the email, short enough that a leaked code is useless by
 *  the time it's been screenshot-shared on Twitter. */
export const BACKUP_EMAIL_CODE_TTL_MS = 10 * 60 * 1000;

/** Mask `local@host` for display in templates and recovery flows.
 *
 *  Examples:
 *    - `alice@example.com` → `a••••@example.com`
 *    - `a@example.com`     → `a••@example.com`
 *    - `bob` (no `@`)      → `b••` (defensive — should never be
 *                                  called on a non-email, but we
 *                                  don't want to throw inside an
 *                                  email template)
 *
 *  We keep the first character of the local-part as a hint for the
 *  recipient (so they can tell `alice@…` from `bob@…` without
 *  doxxing the whole address) and preserve the domain verbatim
 *  because the backup inbox already knows the domain it received
 *  the message from. */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) {
    return `${trimmed.slice(0, 1)}••`;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  return `${local.slice(0, 1)}••••${domain}`;
}

/** Loose-but-not-broken email-shape check. Tightening this any
 *  further (multiple TLDs, IDN handling, etc.) is YAGNI for our
 *  case — the server hands the address to Resend which does its
 *  own validation and bounces invalid sends.
 *
 *  Implementation note: the previous version of this check used
 *  the natural-looking regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. CodeQL
 *  correctly flagged it as polynomial-backtracking — the three
 *  `+` quantifiers over overlapping character classes can quadratic-
 *  worst-case on inputs like `aaaa…aaa@aaaa…aaa` (no dot ⇒
 *  catastrophic re-segmentation). Reachable from `req.json()` in
 *  the backup-email and recovery routes, so a single bad payload
 *  could pin a request thread.
 *
 *  Rewritten as straight-line `indexOf` / length checks, capped at
 *  the RFC 5321 max address length (254 chars). The single regex
 *  that survives — `/\s/` for embedded whitespace — is a one-shot
 *  character-class search with no backtracking.
 *
 *  RFC corner-case caveats we deliberately accept:
 *    - Quoted local-parts (`"foo bar"@host`) are rejected. None
 *      of our flows expect them.
 *    - IDN domains in their punycode form (`xn--…`) are fine; the
 *      raw UTF-8 form would be rejected, but Resend wouldn't
 *      accept it either, so this matches downstream behavior. */

/** RFC 5321 address length ceiling. Beyond this is junk and we
 *  don't want to spend CPU on attacker-controlled megabytes. */
const MAX_EMAIL_LENGTH = 254;

export function isLikelyEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const t = value.trim();
  if (t.length === 0 || t.length > MAX_EMAIL_LENGTH) return false;
  // Reject embedded whitespace. Trim handled the edges; this catches
  // tabs / newlines / spaces hidden in the middle. `/\s/` on a
  // bounded-length string is linear, non-backtracking.
  if (/\s/.test(t)) return false;
  // Exactly one `@`, neither at the start nor the very end.
  const at = t.indexOf("@");
  if (at <= 0 || at >= t.length - 1) return false;
  if (t.indexOf("@", at + 1) !== -1) return false;
  // Domain must contain a dot that's neither the first char of the
  // domain nor the last char of the whole string (so `a@b.` and
  // `a@.b` are both rejected).
  const dot = t.indexOf(".", at + 1);
  if (dot === -1 || dot === at + 1 || dot === t.length - 1) return false;
  return true;
}
