/** URL-safe alphabet for share slugs. Excludes characters that are
 *  visually ambiguous (0/O, 1/l/I) so a slug spoken out loud is
 *  unambiguous. 50 characters → 50^7 ≈ 7.8 × 10^11 possibilities for a
 *  7-char slug — collisions are vanishingly rare even at millions of
 *  shared recipes. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";

/** Default slug length. 7 chars is the sweet spot between collision
 *  probability and shareability — fits comfortably in a URL fragment
 *  and a short verbal mention. */
export const SLUG_LENGTH = 7;

/** Mint a random URL-safe slug of the given length. Uses
 *  `crypto.getRandomValues` for unbiased entropy (rejection-sampling
 *  the alphabet ensures every character is equally likely; modulo bias
 *  from a naïve `% ALPHABET.length` would slightly favor the
 *  alphabet's earliest chars).
 *
 *  Available in any modern runtime (Node 19+, browsers, Vercel Edge,
 *  Cloudflare Workers). */
export function generateShareSlug(length: number = SLUG_LENGTH): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`Invalid slug length: ${length}`);
  }
  const alphabetSize = ALPHABET.length;
  // The largest unbiased threshold inside a uint8 (0–255). Anything
  // ≥ acceptMax rolls again.
  const acceptMax = Math.floor(256 / alphabetSize) * alphabetSize;
  const out: string[] = [];
  // Allocate generously — most reads will be valid, but we may need to
  // top up a few times under unlucky draws.
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      if (buf[i] < acceptMax) out.push(ALPHABET[buf[i] % alphabetSize]);
    }
  }
  return out.join("");
}

/** True iff `s` is a valid-shaped share slug: 6–10 chars from the slug
 *  alphabet. Use at request boundaries to reject obvious garbage
 *  before hitting the database. */
export function isValidShareSlug(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s.length < 6 || s.length > 10) return false;
  for (let i = 0; i < s.length; i++) {
    if (!ALPHABET.includes(s[i])) return false;
  }
  return true;
}
