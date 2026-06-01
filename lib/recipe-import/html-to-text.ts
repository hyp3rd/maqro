/** Lightweight HTML → plain-text reducer.
 *
 *  Used by the AI recipe extraction path: we strip the fetched
 *  page down to readable text before sending it to Claude. The
 *  goal isn't perfect rendering — Claude is robust against noise —
 *  but to (a) get rid of the script/style/navigation cruft that
 *  blows the token budget without informing extraction, and (b)
 *  collapse whitespace so the model sees one paragraph per
 *  paragraph rather than dozens of indentation artefacts.
 *
 *  Not a full HTML parser. We don't pull in cheerio / parse5 / any
 *  of the heavyweight DOM libs because we don't need their
 *  precision — recipe pages have plenty of redundancy and the AI
 *  fills in the gaps. The regex-based approach has the
 *  characteristic flaw of any HTML-via-regex (broken for
 *  pathological inputs), but the failure mode is "AI gets noisier
 *  input" not "wrong recipe extracted" — fine. */

const MAX_OUT_BYTES = 50_000;

export function htmlToReadableText(html: string): string {
  let out = html;
  // Drop the high-noise containers entirely — their contents are
  // never recipe data.
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ");
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ");
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\b[^>]*>/gi, " ");

  // Block-level elements → newline so paragraph structure survives.
  out = out.replace(
    /<\/(?:p|div|li|h[1-6]|tr|br|section|article|header|footer|nav|ul|ol|table|thead|tbody|tfoot)>/gi,
    "\n",
  );
  out = out.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags.
  out = out.replace(/<[^>]+>/g, " ");

  // Decode the entities a recipe page actually uses. Full HTML5
  // entity table isn't worth the bytes for a one-shot AI prompt.
  // Important: decode &amp; last to avoid double-unescaping (e.g. &amp;lt;).
  out = out
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_m, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&amp;/gi, "&");

  // Collapse runs of whitespace and tighten blank lines.
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n[ \t]+/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.trim();

  // Hard cap. Claude can take more but most recipe pages are well
  // under 50 KB after stripping — anything past that is comment
  // sections or related-recipe carousels we don't need.
  if (out.length > MAX_OUT_BYTES) {
    out = out.slice(0, MAX_OUT_BYTES);
  }
  return out;
}
