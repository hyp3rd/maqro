/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_EXPORT_FORMAT,
  MIN_PASSPHRASE_LENGTH,
  decryptExport,
  encryptExport,
  isEncryptedEnvelope,
} from "./export-crypto";

const PLAINTEXT = JSON.stringify({ hello: "world", n: 42, arr: [1, 2, 3] });
const PASS = "correct horse battery staple";

describe("export-crypto", () => {
  it("round-trips plaintext through encrypt → decrypt", async () => {
    const env = await encryptExport(PLAINTEXT, PASS);
    expect(env.format).toBe(ENCRYPTED_EXPORT_FORMAT);
    // The plaintext must not survive in the envelope anywhere.
    expect(env.ciphertext).not.toContain("hello");
    expect(await decryptExport(env, PASS)).toBe(PLAINTEXT);
  });

  it("fails to decrypt with the wrong passphrase", async () => {
    const env = await encryptExport(PLAINTEXT, PASS);
    await expect(decryptExport(env, "wrong passphrase")).rejects.toThrow(
      /wrong passphrase|corrupted/i,
    );
  });

  it("fails closed when the ciphertext is tampered with", async () => {
    const env = await encryptExport(PLAINTEXT, PASS);
    const bytes = Buffer.from(env.ciphertext, "base64");
    bytes[0] ^= 0xff; // flip a byte → GCM auth tag rejects it
    const tampered = { ...env, ciphertext: bytes.toString("base64") };
    await expect(decryptExport(tampered, PASS)).rejects.toThrow();
  });

  it("uses a fresh salt + iv per call (same input → different ciphertext)", async () => {
    const a = await encryptExport(PLAINTEXT, PASS);
    const b = await encryptExport(PLAINTEXT, PASS);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(await decryptExport(a, PASS)).toBe(PLAINTEXT);
    expect(await decryptExport(b, PASS)).toBe(PLAINTEXT);
  });

  it("rejects a passphrase below the minimum length", async () => {
    await expect(
      encryptExport(PLAINTEXT, "x".repeat(MIN_PASSPHRASE_LENGTH - 1)),
    ).rejects.toThrow(/at least/i);
  });

  it("records the iteration count in the envelope", async () => {
    const env = await encryptExport(PLAINTEXT, PASS);
    expect(env.iterations).toBeGreaterThanOrEqual(600_000);
    expect(env.kdf).toBe("PBKDF2-SHA256");
  });

  it("detects encrypted envelopes structurally", async () => {
    const env = await encryptExport(PLAINTEXT, PASS);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(isEncryptedEnvelope({ version: 3, data: {} })).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope("nope")).toBe(false);
  });
});
