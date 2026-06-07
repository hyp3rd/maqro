import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** AES-256-GCM encryption at rest for server-side secrets (the LinkedIn OAuth
 *  tokens). Unlike lib/export-crypto.ts (passphrase + PBKDF2, for user exports),
 *  this uses a STATIC key derived from `SOCIAL_TOKEN_SECRET` so the server can
 *  decrypt on its own at refresh/publish time.
 *
 *  Envelope: `base64(iv).base64(tag).base64(ciphertext)`. The key is
 *  sha256(SOCIAL_TOKEN_SECRET) so any secret of sufficient length yields a valid
 *  32-byte AES key. */

function key(): Buffer | null {
  const secret = process.env.SOCIAL_TOKEN_SECRET;
  if (!secret || secret.length < 32) return null;
  return createHash("sha256").update(secret).digest();
}

export function tokenSecretConfigured(): boolean {
  return key() !== null;
}

export function encryptSecret(plaintext: string): string {
  const k = key();
  if (!k) throw new Error("SOCIAL_TOKEN_SECRET is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(envelope: string): string {
  const k = key();
  if (!k) throw new Error("SOCIAL_TOKEN_SECRET is not configured.");
  const [ivB, tagB, ctB] = envelope.split(".");
  if (!ivB || !tagB || !ctB) throw new Error("Malformed secret envelope.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    k,
    Buffer.from(ivB, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
