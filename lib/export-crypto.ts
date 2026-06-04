/** Client-side, zero-knowledge encryption for export bundles.
 *
 *  An export is encrypted *before* it leaves the device so the storage
 *  backend (Supabase Storage) only ever sees ciphertext — losing the
 *  passphrase means losing the backup, and nobody but the user can read it.
 *
 *  Scheme: PBKDF2-HMAC-SHA256 (600k iterations — OWASP 2023 floor) derives a
 *  256-bit key from the passphrase + a random 16-byte salt; AES-256-GCM with a
 *  random 12-byte IV encrypts the plaintext. GCM's auth tag means a wrong
 *  passphrase (→ wrong key) or any tampering with the ciphertext/salt/IV fails
 *  the decrypt rather than returning garbage. Salt + IV are random per call, so
 *  encrypting the same data twice yields different ciphertext.
 *
 *  Everything rides the Web Crypto API (`crypto.subtle`), available in the
 *  browser and in Node ≥ 20 — no third-party crypto. Pure aside from the two
 *  CSPRNG reads (`getRandomValues`); tested in `./export-crypto.test.ts`. */

/** Marker on the JSON envelope so the importer can tell an encrypted backup
 *  from a plaintext one (older bundles, or a user who opted out). */
export const ENCRYPTED_EXPORT_FORMAT = "maqro-encrypted-export";

/** PBKDF2 iteration count. OWASP's 2023 minimum for PBKDF2-HMAC-SHA256.
 *  Stored in the envelope so a future bump stays backward-compatible — old
 *  backups decrypt with the iteration count they were written with. */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;

/** Shortest passphrase we'll accept. Not a substitute for entropy, but it
 *  stops trivially-empty/one-char passphrases. Enforced at the boundary. */
export const MIN_PASSPHRASE_LENGTH = 8;

/** The self-describing envelope written to storage. Everything except the
 *  ciphertext is non-secret KDF/cipher parameters needed to decrypt. */
export type EncryptedEnvelope = {
  format: typeof ENCRYPTED_EXPORT_FORMAT;
  /** Envelope schema version — bump if the scheme changes. */
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  /** base64. */
  salt: string;
  /** base64. */
  iv: string;
  /** base64 — AES-GCM ciphertext with the 128-bit auth tag appended. */
  ciphertext: string;
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt raw bytes under `passphrase` (the core used by both the string and
 *  the binary — e.g. report PDF — paths). Throws if the passphrase is shorter
 *  than {@link MIN_PASSPHRASE_LENGTH}. */
export async function encryptBytes(
  data: Uint8Array<ArrayBuffer>,
  passphrase: string,
): Promise<EncryptedEnvelope> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(
      `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`,
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return {
    format: ENCRYPTED_EXPORT_FORMAT,
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/** Encrypt a UTF-8 string under `passphrase`, returning the storable envelope. */
export async function encryptExport(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedEnvelope> {
  return encryptBytes(new TextEncoder().encode(plaintext), passphrase);
}

/** Decrypt an envelope back to raw bytes. Throws a readable error on a wrong
 *  passphrase or a tampered/corrupt envelope (AES-GCM's auth tag fails closed —
 *  it never returns garbage). */
export async function decryptBytes(
  envelope: EncryptedEnvelope,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const key = await deriveKey(passphrase, salt, envelope.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      fromBase64(envelope.ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error("Wrong passphrase, or the backup is corrupted.");
  }
}

/** Decrypt an envelope back to the original UTF-8 string. */
export async function decryptExport(
  envelope: EncryptedEnvelope,
  passphrase: string,
): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(envelope, passphrase));
}

/** Structural check: is this parsed JSON an encrypted-export envelope? Used by
 *  the import paths to decide whether to prompt for a passphrase. */
export function isEncryptedEnvelope(x: unknown): x is EncryptedEnvelope {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    o.format === ENCRYPTED_EXPORT_FORMAT &&
    typeof o.ciphertext === "string" &&
    typeof o.salt === "string" &&
    typeof o.iv === "string" &&
    typeof o.iterations === "number"
  );
}
