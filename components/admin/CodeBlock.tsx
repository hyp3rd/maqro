"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/** Pre-formatted code block with a copy-to-clipboard affordance.
 *
 *  Use for stack traces, raw JSON dumps, request bodies - any
 *  text the operator might want to paste somewhere (Stripe
 *  dashboard, Slack ticket, error tracker). The copy button
 *  lives in the top-right and reveals on hover; flashes "Copied"
 *  for 1.2s after a successful write.
 *
 *  Default `maxHeight: 320` caps tall payloads at ~20 lines with
 *  inner scroll so a 4MB stripe payload doesn't push the rest of
 *  the panel off-screen. Pass `0` to remove the cap when needed.
 *
 *  The mono font + leading-relaxed are tuned for stack traces
 *  (longest format we render); JSON looks fine in the same
 *  treatment since both are dense + line-oriented. */

export function CodeBlock({
  children,
  copy,
  maxHeight = 320,
  label,
  className,
}: {
  children: React.ReactNode;
  /** Text to put on the clipboard when the user clicks Copy.
   *  When omitted, the Copy button doesn't render - use for
   *  display-only content (e.g. you've already stringified
   *  JSON for display but want the user to copy the OBJECT
   *  not the formatted string; pass the original via this
   *  prop). */
  copy?: string;
  /** 0 = no cap. Otherwise pixels. */
  maxHeight?: number;
  /** Optional small label above the block ("Stack" / "Payload").
   *  Saves a separate label-then-pre dance at the caller. */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function doCopy() {
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
    } catch {
      // Clipboard API unavailable - fall back to nothing. The
      // user can still select the text manually.
    }
  }

  return (
    // `min-w-0` lets the block honour its parent's width when sat
    // inside a flex/grid column. Without it the inner `<pre>`'s
    // natural (un-wrapped) JSON width propagates outward and
    // pushes the whole detail panel past the viewport edge —
    // visible on phones as the "Open in Stripe dashboard" button
    // being clipped off the right side. `overflow-auto` on the
    // `<pre>` only does its job when *something* in the chain
    // constrains the available width.
    <div className={`min-w-0 space-y-1.5 ${className ?? ""}`}>
      {label && (
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      )}
      <div className="group relative overflow-hidden rounded-md border border-border/60 bg-muted/30">
        {copy && (
          <button
            type="button"
            onClick={doCopy}
            className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 items-center gap-1 rounded-md border border-border/60 bg-background/95 px-1.5 text-[10px] text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        )}
        <pre
          className="overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground"
          style={maxHeight > 0 ? { maxHeight: `${maxHeight}px` } : undefined}
        >
          {children}
        </pre>
      </div>
    </div>
  );
}
