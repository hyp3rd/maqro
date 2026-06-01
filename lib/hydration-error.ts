/** Detection + extraction helpers for React hydration-mismatch errors.
 *
 *  React logs hydration mismatches (#418 text-content, #423/#425 tree)
 *  through `console.error` as a RECOVERABLE error — it regenerates the
 *  tree on the client and carries on, so the error never reaches a
 *  React error boundary or the window `error` event. The only place to
 *  intercept it app-wide is `console.error` itself.
 *
 *  Crucially, the JS stack on such an error names minified React
 *  internals, not the offending component. The actionable signal is the
 *  COMPONENT STACK that React passes as a separate argument to
 *  `console.error` — present and readable in dev, which is why
 *  reproducing locally with this reporter wired yields a report that
 *  names the component.
 *
 *  Kept pure + framework-free so the matching logic is unit-testable
 *  without a DOM. */

/** Substrings that identify a hydration-mismatch console.error across
 *  dev (verbose message) and prod (minified error + react.dev link).
 *  418 = text content, 423/425 = full-tree / attribute mismatches. */
const HYDRATION_SIGNATURES = [
  "hydration failed",
  "did not match",
  "didn't match",
  "text content does not match",
  "minified react error #418",
  "minified react error #423",
  "minified react error #425",
  "react.dev/errors/418",
  "react.dev/errors/423",
  "react.dev/errors/425",
];

/** True when this `console.error` call looks like a React hydration
 *  mismatch. Scans every string-ish argument (React spreads the format
 *  string + substitutions across args). */
export function isHydrationError(args: readonly unknown[]): boolean {
  for (const arg of args) {
    const s =
      typeof arg === "string"
        ? arg
        : arg instanceof Error
          ? arg.message
          : undefined;
    if (!s) continue;
    const lower = s.toLowerCase();
    if (HYDRATION_SIGNATURES.some((sig) => lower.includes(sig))) return true;
  }
  return false;
}

/** Pull the React component stack out of the console.error arguments.
 *  React passes it as a string argument shaped like:
 *
 *      \n    at SomeComponent (...)\n    at Parent (...)
 *
 *  We pick the argument that contains the most "    at " frames — in
 *  dev that names real components; in prod it's typically absent (so
 *  this returns undefined and the caller falls back to the raw
 *  message). */
export function extractComponentStack(
  args: readonly unknown[],
): string | undefined {
  let best: string | undefined;
  let bestFrames = 0;
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    const frames = (arg.match(/\n\s*at\s/g) ?? []).length;
    if (frames > bestFrames) {
      best = arg;
      bestFrames = frames;
    }
  }
  return bestFrames > 0 ? best?.trim() : undefined;
}

/** Build a concise, single-line summary from the console.error args —
 *  the human-readable message for the report. Joins the string-ish
 *  args, collapses whitespace, and caps length so a giant component
 *  stack doesn't bloat the message field (the stack travels separately
 *  in context). */
export function summarizeHydrationArgs(args: readonly unknown[]): string {
  const parts: string[] = [];
  for (const arg of args) {
    if (typeof arg === "string") parts.push(arg);
    else if (arg instanceof Error) parts.push(arg.message);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}
