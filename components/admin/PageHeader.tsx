import type { LucideIcon } from "lucide-react";

/** Page-level header for the admin pages. One per page, at the
 *  top, replaces the ad-hoc `<header><h1>…</h1></header>` shapes
 *  each page was doing slightly differently.
 *
 *  Anatomy:
 *
 *    [icon halo] Title (display font)               [actions →]
 *                description / tagline
 *    ──────────────────────────────────────────────────────────
 *
 *  The icon halo gives the page a visual anchor - operators
 *  glance left to know "where am I". The thin bottom rule
 *  visually separates the heading from the content below
 *  without adding a heavy card-style border.
 *
 *  `tone` colors the icon halo to match the page's character
 *  (e.g. amber for Errors, blue for Users) - entirely optional;
 *  default tone keeps it neutral. */

type Tone = "default" | "emerald" | "amber" | "red" | "blue";

const TONE_CLASSES: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  emerald:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/20",
  amber:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/20",
  red: "bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-500/20",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-1 ring-blue-500/20",
};

export function PageHeader({
  icon: Icon,
  title,
  description,
  tone = "default",
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  /** String for the common case; ReactNode when a page needs richer
   *  subtitle content (e.g. the user-detail page puts a CopyableId
   *  here). Rendered inside the muted subtitle `<p>` either way. */
  description?: React.ReactNode;
  tone?: Tone;
  actions?: React.ReactNode;
}) {
  return (
    <header className="space-y-3 border-b border-border/60 pb-4">
      {/* Mobile: stack title above the action row so the title
          gets the full row width. The action block is often a
          chunky chip group (e.g. "Last 7 days / Last 30 days /
          Last 90 days") that, when side-by-side at 375 px,
          consumes ~270 px and squeezes the title down to ~50 px
          — making it wrap one word per line (truncated). At sm+
          we restore the side-by-side layout where there's room.
          Action row gets `flex-wrap` so any wide cluster (e.g.
          status + range chips together) flows to two rows
          instead of overflowing horizontally. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONE_CLASSES[tone]}`}
              aria-hidden
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 space-y-0.5">
            <h1 className="font-display text-xl font-semibold tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
