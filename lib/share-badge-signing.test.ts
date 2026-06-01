import { describe, expect, it } from "vitest";
import type { ShareBadgeNumbers } from "./share-badge";
import {
  signShareBadgeWithSecret,
  verifyShareBadgeWithSecret,
} from "./share-badge-signing";

const SECRET = "test-secret-with-enough-entropy-1234567890";
const OTHER_SECRET = "different-secret-with-enough-entropy-abcdefg";

const NUMBERS: ShareBadgeNumbers = {
  caloriesCurrent: 1576,
  caloriesTarget: 1682,
  proteinCurrent: 230,
  proteinTarget: 231,
  carbsCurrent: 81,
  carbsTarget: 126,
  fatCurrent: 25,
  fatTarget: 28,
};

describe("signShareBadgeWithSecret + verifyShareBadgeWithSecret", () => {
  it("round-trips: a sig made with secret S verifies under S", async () => {
    const sig = await signShareBadgeWithSecret(NUMBERS, SECRET);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
    await expect(
      verifyShareBadgeWithSecret(NUMBERS, sig, SECRET),
    ).resolves.toBe(true);
  });

  it("rejects a sig made under a different secret", async () => {
    const sig = await signShareBadgeWithSecret(NUMBERS, SECRET);
    await expect(
      verifyShareBadgeWithSecret(NUMBERS, sig, OTHER_SECRET),
    ).resolves.toBe(false);
  });

  it("rejects when any single number is tampered", async () => {
    const sig = await signShareBadgeWithSecret(NUMBERS, SECRET);
    const tampered: ShareBadgeNumbers = { ...NUMBERS, caloriesCurrent: 9999 };
    await expect(
      verifyShareBadgeWithSecret(tampered, sig, SECRET),
    ).resolves.toBe(false);
  });

  it("rejects an empty sig", async () => {
    await expect(verifyShareBadgeWithSecret(NUMBERS, "", SECRET)).resolves.toBe(
      false,
    );
  });

  it("rejects a sig with non-URL-safe characters", async () => {
    await expect(
      verifyShareBadgeWithSecret(NUMBERS, "not/valid+base64url!", SECRET),
    ).resolves.toBe(false);
  });

  it("produces URL-safe base64 with no padding", async () => {
    const sig = await signShareBadgeWithSecret(NUMBERS, SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sig).not.toMatch(/=$/);
  });

  it("produces a deterministic sig for the same input", async () => {
    const a = await signShareBadgeWithSecret(NUMBERS, SECRET);
    const b = await signShareBadgeWithSecret(NUMBERS, SECRET);
    expect(a).toBe(b);
  });

  it("produces different sigs for different number sets", async () => {
    const a = await signShareBadgeWithSecret(NUMBERS, SECRET);
    const b = await signShareBadgeWithSecret(
      { ...NUMBERS, caloriesCurrent: 1577 },
      SECRET,
    );
    expect(a).not.toBe(b);
  });
});
