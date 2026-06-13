"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/** Render an opaque identifier (UUID, Stripe id, etc.) with a
 *  click-to-copy affordance. The label is truncated by default
 *  (`<first8>…`) so the row doesn't sprawl; full id lands in
 *  the clipboard on click and shows up in the `title` tooltip
 *  on hover.
 *
 *  Why bother: operators copy these values constantly (looking
 *  up a user in Stripe, joining audit rows by target_user_id,
 *  filing tickets that reference an event id). The previous
 *  pattern — manually selecting the truncated text in the row
 *  — frequently grabbed surrounding whitespace and missed the
 *  hidden suffix. */

export function CopyableId({
  value,
  display,
  className,
}: {
  value: string;
  /** Optional override for what the user sees. Defaults to the
   *  first 8 chars + ellipsis. Pass the full value when the row
   *  has space, or a shorter slice on dense tables. */
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (insecure context, restricted
      // browser) — fall back to the rendered string. The user can
      // still select it manually; we just can't auto-flash the
      // "Copied" affordance.
    }
  }

  const shown = display ?? `${value.slice(0, 8)}…`;

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : value}
      className={[
        // `coarse:min-h-11` gives the tap a 44px target on touch without
        // enlarging the dense desktop rows.
        "group inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="truncate">{shown}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        // Hover-reveal on mouse, but always semi-visible on touch — there's
        // no hover on a phone, so opacity-0 made the affordance invisible.
        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-60" />
      )}
    </button>
  );
}
