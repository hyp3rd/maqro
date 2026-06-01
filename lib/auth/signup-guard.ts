import { isLikelyEmail } from "@/lib/account/backup-email";
import disposableDomains from "disposable-email-domains";

/** Server-side abuse guard for the email-OTP signup path.
 *
 *  Two checks:
 *
 *    1. **Disposable-email block**: the well-maintained
 *       `disposable-email-domains` list (~120k domains) covers every
 *       Mailinator-class spam mailbox we've seen show up in real
 *       abuse traffic. Blocking these cuts off the "sign up a
 *       throwaway and burn the free tier" pattern.
 *
 *    2. **Rate limiting**: the actual throttle lives at the route
 *       (via the existing checkAuthRateLimit infrastructure) — this
 *       module just validates the inputs and returns a structured
 *       reason on rejection. Separating the two keeps the guard
 *       unit-testable without standing up a Supabase mock.
 *
 *  Why a server-side gate at all when Supabase itself accepts the
 *  signup: a sophisticated attacker can always call Supabase directly
 *  and bypass us. The gate is meaningful because casual abuse goes
 *  through the UI we control, and the disposable-list filter alone
 *  drops the majority of bot signups we've seen — well worth a
 *  pre-flight HTTP call before invoking Supabase's signInWithOtp. */

const DISPOSABLE = new Set<string>(disposableDomains);

export type SignupCheckResult =
  | { allowed: true; email: string }
  | { allowed: false; reason: "invalid-email" | "disposable-domain" };

/** Cheap synchronous shape + disposable check. Does NOT do rate
 *  limiting — the route layer composes this with checkAuthRateLimit
 *  so the heavy I/O (the throttle RPC) only runs after the cheap
 *  filters pass. */
export function checkSignupEmail(rawEmail: unknown): SignupCheckResult {
  if (typeof rawEmail !== "string") {
    return { allowed: false, reason: "invalid-email" };
  }
  const email = rawEmail.trim().toLowerCase();
  if (!isLikelyEmail(email)) {
    return { allowed: false, reason: "invalid-email" };
  }
  if (isDisposableDomain(email)) {
    return { allowed: false, reason: "disposable-domain" };
  }
  return { allowed: true, email };
}

/** Extract the domain and check it against the disposable list.
 *  Plus-addressed and dotted-prefix gmail-style local parts don't
 *  affect the domain extraction, but a user with a `foo+bar@yopmail.com`
 *  address is still blocked — yopmail is the disposable signal, not
 *  the local part. */
export function isDisposableDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE.has(domain)) return true;
  // Many disposable providers operate on apex + a long tail of
  // subdomains (e.g. `*.mailinator.com`, `*.yopmail.com`). The
  // upstream list IS apex-shaped, so we walk the parent labels too
  // and bail at the registrable boundary (≥ 2 labels, ≥ 4 chars).
  let cursor = domain;
  while (true) {
    const dot = cursor.indexOf(".");
    if (dot === -1) return false;
    cursor = cursor.slice(dot + 1);
    if (cursor.length < 4 || !cursor.includes(".")) return false;
    if (DISPOSABLE.has(cursor)) return true;
  }
}
