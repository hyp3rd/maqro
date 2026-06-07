/** Deterministic voice enforcement for generated social copy. Tone is NOT left
 *  to the model: every draft passes through here before it is stored or shown.
 *
 *  `lintTone` does two things:
 *   - auto-fixes the mechanical tells (emoji, em/en dashes used as separators,
 *     exclamation marks, repeated punctuation) and returns the cleaned text;
 *   - flags the judgement calls it must not silently rewrite (marketing clichés,
 *     hashtag dumps, over-length) as warnings the reviewer sees in the dashboard.
 *
 *  Pure + unit-tested — this is the guarantee behind "professional, concise, no
 *  emoji / em-dash abuse / AI tells". */

export type ToneResult = { text: string; warnings: string[] };

// Main emoji blocks + variation selectors + ZWJ + regional-indicator flags.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

/** Lower-cased marketing clichés / AI tells. Flagged (not auto-removed — ripping
 *  them out would mangle the sentence) so the reviewer rewrites them. Extend
 *  freely. */
const BANNED_PHRASES: readonly string[] = [
  "we're thrilled",
  "we are thrilled",
  "we're excited",
  "we are excited",
  "thrilled to announce",
  "excited to announce",
  "game-changer",
  "game changer",
  "seamless",
  "seamlessly",
  "robust",
  "unleash",
  "elevate",
  "supercharge",
  "effortless",
  "effortlessly",
  "revolutionize",
  "revolutionary",
  "in today's fast-paced",
  "dive in",
  "delve",
  "take it to the next level",
  "best-in-class",
  "cutting-edge",
  "state-of-the-art",
  "leverage",
  "synergy",
  "empower",
  "unlock the power",
  "look no further",
  "say goodbye to",
  "the future of",
  "more than just",
];

export function lintTone(
  text: string,
  opts: { maxLength?: number } = {},
): ToneResult {
  const warnings: string[] = [];
  let out = text;

  // ── auto-fix the mechanical tells ──────────────────────────────────────────
  const emojiCount = (out.match(EMOJI_RE) ?? []).length;
  if (emojiCount > 0) {
    out = out.replace(EMOJI_RE, "");
    warnings.push(`Removed ${emojiCount} emoji.`);
  }

  if (/[—–]/.test(out)) {
    // Em/en dash used as a sentence separator is the signature AI tell. A comma
    // is the safe universal replacement; the reviewer can promote to a period.
    out = out.replace(/\s*[—–]\s*/g, ", ");
    warnings.push("Replaced em/en dash with a comma.");
  }

  if (/!/.test(out)) {
    out = out.replace(/\s*!+/g, ".");
    warnings.push("Removed exclamation mark(s).");
  }

  // Collapse repeated punctuation (keep a 3-dot ellipsis, cap longer runs).
  out = out.replace(/\?{2,}/g, "?").replace(/\.{4,}/g, "...");

  // Tidy the artifacts the replacements can leave (", ." → "." etc.).
  out = out
    .replace(/,\s*([.,])/g, "$1")
    .replace(/\.\s*,/g, ".")
    .replace(/ ([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/^[\s,.;:]+/, "")
    .trim();

  // ── flag the judgement calls (do not rewrite) ──────────────────────────────
  const lower = out.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) warnings.push(`Cliché: "${phrase}".`);
  }

  const hashtags = (out.match(/#\w+/g) ?? []).length;
  if (hashtags > 3) warnings.push(`${hashtags} hashtags (keep it to a few).`);

  if (opts.maxLength && out.length > opts.maxLength) {
    warnings.push(`${out.length} chars, over the ${opts.maxLength} limit.`);
  }

  return { text: out, warnings };
}
