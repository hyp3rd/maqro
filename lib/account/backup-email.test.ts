import { describe, expect, it } from "vitest";
import {
  BACKUP_EMAIL_CODE_TTL_MS,
  generateBackupEmailCode,
  hashBackupEmailCode,
  isLikelyEmail,
  maskEmail,
} from "./backup-email";

describe("generateBackupEmailCode", () => {
  it("returns a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateBackupEmailCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("doesn't always return the same value", () => {
    // Cryptographic randomness — 50 calls returning the same code
    // would be ~1e-300 probability; this is really a sanity check
    // that the function actually re-rolls and isn't a constant.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateBackupEmailCode());
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("hashBackupEmailCode", () => {
  it("returns sha-256 hex (64 chars, lowercase)", () => {
    const h = hashBackupEmailCode("123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashBackupEmailCode("000000")).toBe(hashBackupEmailCode("000000"));
  });

  it("changes when the input changes", () => {
    expect(hashBackupEmailCode("000000")).not.toBe(
      hashBackupEmailCode("000001"),
    );
  });
});

describe("BACKUP_EMAIL_CODE_TTL_MS", () => {
  it("is 10 minutes", () => {
    expect(BACKUP_EMAIL_CODE_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe("maskEmail", () => {
  it("preserves the first letter of local + the full domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a••••@example.com");
  });

  it("handles single-letter local parts", () => {
    expect(maskEmail("a@example.com")).toBe("a••••@example.com");
  });

  it("falls back gracefully on non-email input", () => {
    // Defensive — never called on a non-email in practice but the
    // templates need a string return so an upstream typo doesn't
    // render `undefined` in customer-facing copy.
    expect(maskEmail("bob")).toBe("b••");
    expect(maskEmail("")).toBe("••");
  });

  it("trims whitespace before masking", () => {
    expect(maskEmail("  alice@example.com  ")).toBe("a••••@example.com");
  });
});

describe("isLikelyEmail", () => {
  it("accepts common shapes", () => {
    expect(isLikelyEmail("alice@example.com")).toBe(true);
    expect(isLikelyEmail("a+tag@ex.co.uk")).toBe(true);
  });

  it("rejects junk", () => {
    expect(isLikelyEmail("")).toBe(false);
    expect(isLikelyEmail("not-an-email")).toBe(false);
    expect(isLikelyEmail("a@")).toBe(false);
    expect(isLikelyEmail("@b")).toBe(false);
    expect(isLikelyEmail("a@b")).toBe(false); // no TLD
    expect(isLikelyEmail(42)).toBe(false);
    expect(isLikelyEmail(null)).toBe(false);
  });

  it("rejects multiple @ signs", () => {
    expect(isLikelyEmail("a@b@example.com")).toBe(false);
  });

  it("rejects embedded whitespace anywhere", () => {
    // Trim catches edges; this check guards against tab / newline /
    // space hidden mid-string (e.g., copy-paste from a wrapped line).
    expect(isLikelyEmail("a li ce@example.com")).toBe(false);
    expect(isLikelyEmail("alice@exa mple.com")).toBe(false);
    expect(isLikelyEmail("alice@\texample.com")).toBe(false);
  });

  it("tolerates leading/trailing whitespace (trim handles it)", () => {
    // `trim()` runs first, so edge whitespace is normalized away.
    // Only embedded whitespace (the test above) is a reject.
    expect(isLikelyEmail("  alice@example.com  ")).toBe(true);
    expect(isLikelyEmail("alice@example.com\n")).toBe(true);
  });

  it("rejects a dot at the domain boundary or end", () => {
    expect(isLikelyEmail("alice@.com")).toBe(false);
    expect(isLikelyEmail("alice@example.")).toBe(false);
  });

  it("rejects oversized inputs without running into polynomial regex risk", () => {
    // Pre-fix, an input like `aa..a@aa..a` (no dot in domain) was
    // the ReDoS vector CodeQL flagged. The length cap forecloses
    // it: 1_000_000-char input bounces in a single property read.
    const huge = `${"a".repeat(1_000_000)}@${"a".repeat(1_000_000)}`;
    expect(isLikelyEmail(huge)).toBe(false);
    // Exactly at the 254-char cap should still parse normally if
    // it's a valid shape.
    const local = "a".repeat(64);
    const domain = `${"b".repeat(180 - 4)}.co`;
    const at254 = `${local}@${domain}`;
    expect(at254.length).toBeLessThanOrEqual(254);
    expect(isLikelyEmail(at254)).toBe(true);
  });
});
