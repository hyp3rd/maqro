import type { LucideIcon } from "lucide-react";

/** Shared empty-state shell for the admin pages.
 *
 *  Previously each table rendered its own one-liner ("No users
 *  yet." / "No actions yet." / etc.), which read flat against
 *  the surrounding card chrome and gave no visual anchor when
 *  a filter narrowed to zero. This component:
 *
 *    - puts a muted icon at the top so the empty state has
 *      visual weight equivalent to a populated row
 *    - separates title (what's empty) from description (why
 *      and what to do about it)
 *    - optional action slot for "Clear filters" or "Try a
 *      different search" — surface to recovery affordances
 *      from the same place as the empty signal
 *
 *  Render inside the existing card border (no own border) so
 *  it stays consistent with the populated table next to it. */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-2 px-4 py-10 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon
        className="h-6 w-6 text-muted-foreground/60"
        aria-hidden
      />
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
