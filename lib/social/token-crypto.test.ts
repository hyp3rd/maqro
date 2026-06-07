import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  tokenSecretConfigured,
} from "./token-crypto";

const PREV = process.env.SOCIAL_TOKEN_SECRET;
beforeAll(() => {
  process.env.SOCIAL_TOKEN_SECRET = "a-test-secret-at-least-32-chars-long!!";
});
afterAll(() => {
  if (PREV === undefined) delete process.env.SOCIAL_TOKEN_SECRET;
  else process.env.SOCIAL_TOKEN_SECRET = PREV;
});

describe("token-crypto", () => {
  it("round-trips a secret", () => {
    const secret = "AQX-linkedin-access-token-value-123";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("uses a fresh iv each call (ciphertext differs for the same input)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered envelope (GCM auth tag)", () => {
    const [iv, tag] = encryptSecret("secret").split(".");
    const forged = `${iv}.${tag}.${Buffer.from("tampered").toString("base64")}`;
    expect(() => decryptSecret(forged)).toThrow();
  });

  it("reports configured when the secret is set", () => {
    expect(tokenSecretConfigured()).toBe(true);
  });
});
