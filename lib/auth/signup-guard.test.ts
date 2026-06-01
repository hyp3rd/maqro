import { describe, expect, it } from "vitest";
import { checkSignupEmail, isDisposableDomain } from "./signup-guard";

describe("checkSignupEmail — shape validation", () => {
  it("rejects non-string input", () => {
    expect(checkSignupEmail(null).allowed).toBe(false);
    expect(checkSignupEmail(undefined).allowed).toBe(false);
    expect(checkSignupEmail(42).allowed).toBe(false);
    expect(checkSignupEmail({}).allowed).toBe(false);
  });

  it("rejects malformed emails", () => {
    expect(checkSignupEmail("").allowed).toBe(false);
    expect(checkSignupEmail("not-an-email").allowed).toBe(false);
    expect(checkSignupEmail("@example.com").allowed).toBe(false);
    expect(checkSignupEmail("user@").allowed).toBe(false);
    expect(checkSignupEmail("user@no-tld").allowed).toBe(false);
  });

  it("rejects emails over the 254-char RFC ceiling", () => {
    const huge = `${"a".repeat(250)}@example.com`;
    expect(checkSignupEmail(huge).allowed).toBe(false);
  });

  it("normalizes to lowercase + trims whitespace", () => {
    const r = checkSignupEmail("  USER@EXAMPLE.COM  ");
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.email).toBe("user@example.com");
  });

  it("accepts a well-formed email", () => {
    expect(checkSignupEmail("alice@example.com").allowed).toBe(true);
  });

  it("rejects the SAST-flagged adversarial ReDoS input in bounded time", () => {
    // The previous regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` backtracked
    // catastrophically on `!@!.!.!.!.…` because `[^\s@]+` matches
    // dots too — every dot is a possible split point for the final
    // anchor, and the engine retries all of them. The linear
    // imperative validator must reject in O(n).
    const adversarial = `!@${".!".repeat(50)}.`;
    const start = Date.now();
    const r = checkSignupEmail(adversarial);
    const elapsed = Date.now() - start;
    // Generous bound — the new validator runs in single-digit
    // microseconds. The old regex took seconds on this input.
    expect(elapsed).toBeLessThan(50);
    expect(r.allowed).toBe(false);
  });
});

describe("checkSignupEmail — disposable-domain block", () => {
  it("rejects a well-known throwaway provider", () => {
    // mailinator + yopmail are the canonical disposable mailbox
    // services and are guaranteed-present in the upstream list.
    const r = checkSignupEmail("alice@mailinator.com");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("disposable-domain");
  });

  it("rejects yopmail variants", () => {
    expect(checkSignupEmail("test@yopmail.com").allowed).toBe(false);
  });

  it("accepts mainstream personal email providers", () => {
    expect(checkSignupEmail("user@gmail.com").allowed).toBe(true);
    expect(checkSignupEmail("user@outlook.com").allowed).toBe(true);
    expect(checkSignupEmail("user@protonmail.com").allowed).toBe(true);
  });
});

describe("isDisposableDomain — direct API", () => {
  it("matches a subdomain of a listed disposable provider", () => {
    // Common pattern: disposable services own *.example with many
    // subdomains active at any one time. We walk parent labels so
    // `subdomain.mailinator.com` is caught even if the list only
    // has `mailinator.com`.
    expect(isDisposableDomain("test@subdomain.mailinator.com")).toBe(true);
  });

  it("does NOT false-positive on a suffix similarity", () => {
    // The matcher walks DNS labels, not raw string suffixes — so a
    // domain that just HAPPENS to end in the same letters as a
    // listed provider must NOT match. (We can't use real-domain
    // examples here because the upstream list is so comprehensive
    // that "notmailinator.com" turns out to ALSO be a listed
    // disposable provider — confirmation that the list is doing
    // its job, but not useful for testing the walker's behaviour.
    // Use a contrived TLD to isolate the matcher logic.)
    expect(isDisposableDomain("test@notmailinator.example-tld")).toBe(false);
  });

  it("returns false for an obviously legit domain", () => {
    expect(isDisposableDomain("user@anthropic.com")).toBe(false);
  });

  it("handles malformed input without throwing", () => {
    expect(isDisposableDomain("no-at-sign")).toBe(false);
    expect(isDisposableDomain("@")).toBe(false);
    expect(isDisposableDomain("")).toBe(false);
  });
});
