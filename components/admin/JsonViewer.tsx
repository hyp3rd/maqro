"use client";

import { CodeBlock } from "./CodeBlock";

/** Render a JSON value with light syntax highlighting + a
 *  built-in copy button (wraps `CodeBlock`).
 *
 *  Why not a real JSON tree component:
 *
 *    - Most admin payloads are dense and shallow (Stripe events,
 *      error contexts, audit traces). A tree adds toggle UI
 *      noise without saving lines.
 *    - A real syntax-aware renderer (Prism / Shiki) is ~50KB on
 *      the client; for an admin-only page with two payload
 *      shapes this is wasteful.
 *
 *  Compromise: regex-driven tokenization. Highlights strings,
 *  numbers, booleans, nulls, and keys. Good enough that the
 *  payload READS as JSON rather than a beige wall of text;
 *  cheap enough to live in the bundle for free. */

type Token = { text: string; className: string };

/** Tokenize a single formatted-JSON line. We pretty-print first
 *  (so each line has at most one literal of interest) and tokenize
 *  per line - keeps the regex tractable and lets the renderer be
 *  a `.map` over `<span>`s with no parser. */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  // Match in order of specificity: keys ("key":) → strings → numbers
  // → booleans/nulls → punctuation passthrough.
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\]:,])|(\s+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({
        text: line.slice(lastIndex, m.index),
        className: "text-foreground",
      });
    }
    const [, str, colon, num, kw, punct, ws] = m;
    if (str !== undefined) {
      // If followed by `:`, this is a key - treat differently
      // so keys stand out from value strings.
      tokens.push({
        text: str,
        className:
          colon !== undefined
            ? "text-foreground"
            : "text-emerald-700 dark:text-emerald-400",
      });
      if (colon !== undefined) {
        tokens.push({ text: colon, className: "text-muted-foreground" });
      }
    } else if (num !== undefined) {
      tokens.push({ text: num, className: "text-blue-700 dark:text-blue-400" });
    } else if (kw !== undefined) {
      tokens.push({
        text: kw,
        className: "text-amber-700 dark:text-amber-400",
      });
    } else if (punct !== undefined) {
      tokens.push({ text: punct, className: "text-muted-foreground" });
    } else if (ws !== undefined) {
      tokens.push({ text: ws, className: "" });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), className: "text-foreground" });
  }
  return tokens;
}

export function JsonViewer({
  value,
  label,
  maxHeight,
  className,
}: {
  /** The thing to render. Accepts any JSON-serializable input;
   *  unserializable values fall back to `String(value)`. */
  value: unknown;
  label?: string;
  maxHeight?: number;
  className?: string;
}) {
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }
  const lines = formatted.split("\n");
  return (
    <CodeBlock
      copy={formatted}
      label={label}
      maxHeight={maxHeight}
      className={className}
    >
      {lines.map((line, i) => (
        <div key={i}>
          {tokenizeLine(line).map((tok, j) => (
            <span
              key={j}
              className={tok.className}
            >
              {tok.text}
            </span>
          ))}
          {/* Preserve empty lines visually - the trailing space
           *  keeps the `div` from collapsing to 0px height. */}
          {line === "" ? " " : null}
        </div>
      ))}
    </CodeBlock>
  );
}
