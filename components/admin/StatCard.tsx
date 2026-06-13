import { cn } from "@/lib/utils";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";

/** Single-stat card for the admin overview grid.
 *
 *  Layout:
 *
 *    ┌────────────────────────────────────────┐
 *    │ [icon]  LABEL                       ↗ │  ← top row
 *    │                                        │
 *    │  3,421                                 │  ← headline value
 *    │  +24 last 24h                          │  ← hint
 *    └────────────────────────────────────────┘
 *
 *  Three visual treatments:
 *
 *    - **plain** (default) — neutral chrome. The headline value
 *      carries the weight.
 *    - **toned** (emerald / amber / red) — toned icon halo +
 *      faint tint on the card surface. Use SPARINGLY: the
 *      operator's eye should be drawn to the one or two cards
 *      with an active signal, not the whole grid.
 *
 *  When `href` is set the whole card becomes a Link and a small
 *  ↗ glyph appears on hover in the top-right. The hover state
 *  also lifts the card with a tiny translate + shadow, which
 *  reads as "clickable tile" without needing a separate CTA. */

type Tone = "default" | "emerald" | "amber" | "red";

const TONE_ICON: Record<Tone, string> = {
  default: "bg-muted/60 text-muted-foreground",
  emerald:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/20",
  amber:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/20",
  red: "bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-500/20",
};

const TONE_CARD: Record<Tone, string> = {
  default: "border-border/60",
  emerald: "border-emerald-500/20 bg-emerald-500/[0.02]",
  amber: "border-amber-500/30 bg-amber-500/[0.03]",
  red: "border-red-500/30 bg-red-500/[0.03]",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  href,
  tone = "default",
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  tone?: Tone;
  /** Applied to the outermost element (the Link when `href` is set, else
   *  the article) — e.g. `col-span-2` to span a grid track. */
  className?: string;
}) {
  const isClickable = Boolean(href);
  const body = (
    <article
      className={cn(
        // `p-4 sm:p-5` — tighter on phones so a 2-up grid card has room for
        // the label without clipping.
        "group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 transition-all sm:p-5",
        TONE_CARD[tone],
        isClickable &&
          "hover:-translate-y-px hover:shadow-md hover:shadow-foreground/5",
        // Only put the caller's className on the article when it's the
        // outermost element (no href); otherwise it goes on the Link below.
        !href && className,
      )}
    >
      {/* Subtle decorative ring on the right side of the card —
       *  adds visual interest without competing with the data.
       *  Hidden on default tone to keep the neutral cards quiet. */}
      {tone !== "default" && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-30 blur-2xl"
          style={{
            background:
              tone === "emerald"
                ? "rgb(16 185 129 / 0.4)"
                : tone === "amber"
                  ? "rgb(245 158 11 / 0.4)"
                  : "rgb(239 68 68 / 0.4)",
          }}
        />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          {/* truncate is the safety net for a too-narrow card; min-w-0 on the
              parent lets it actually shrink instead of overflowing the box. */}
          <h3 className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </h3>
        </div>
        {isClickable && (
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <p className="relative font-display font-semibold tabular-nums text-foreground text-[2rem] leading-none">
        {value}
      </p>
      {hint && (
        <p className="relative text-[11px] leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
    </article>
  );

  return href ? (
    <Link
      href={href}
      className={cn(
        "block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {body}
    </Link>
  ) : (
    body
  );
}
