import type { LucideIcon } from "lucide-react";

/** Small status badge used across the admin pages.
 *
 *  Five tones cover every status-flavored signal we render:
 *
 *    - `emerald` — positive / success (Paid, Active, Premium)
 *    - `amber`   — attention / in-flight (Past due, Traced, Open)
 *    - `red`     — negative / blocking (Banned, Failed, Uncollectible)
 *    - `blue`    — informational / neutral-positive (Admin role)
 *    - `muted`   — neutral / inactive (Void, Free, default)
 *
 *  Always rendered with a thin ring so the colour-only signal
 *  carries on light backgrounds where the 10%-tint fill is too
 *  faint. The `icon` slot is optional — including one helps the
 *  semantics (a Ban icon next to "Banned" reinforces severity
 *  without making the row noisy).
 *
 *  Centralized here rather than re-implemented per-page so a
 *  future tweak (different tones for dark mode, dropping the
 *  ring, etc.) is a single-file change. */

export type PillTone = "emerald" | "amber" | "red" | "blue" | "muted";

const TONE_CLASSES: Record<PillTone, string> = {
  emerald:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
  red: "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/20",
  muted: "bg-muted text-muted-foreground ring-border/60",
};

export function Pill({
  tone = "muted",
  icon: Icon,
  children,
  className,
}: {
  tone?: PillTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}
