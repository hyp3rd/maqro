import { cn } from "@/lib/utils";

/** Atomic skeleton block — a single pulsing rounded rectangle. The
 *  composition helpers below assemble multiple atoms into the row /
 *  card shapes the list views actually need; reach for the atom when
 *  building a one-off skeleton, and for the named composition when
 *  the shape already has two consumers (avoids drifting layouts the
 *  way the per-view bespoke skeletons did before extraction). */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      aria-hidden
      {...props}
    />
  );
}

/** "Icon + two-line text" row, used by lists of cards with a leading
 *  icon column — Recipes, Templates, similar. Pass `className` to
 *  override the outer border/padding when the host list draws its
 *  own row chrome. */
function SkeletonListRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-border/40 px-3 py-2.5",
        className,
      )}
      aria-hidden
      {...props}
    >
      <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
    </div>
  );
}

/** Compact "title + subtitle + chips" card, used by MyFoods and any
 *  list that surfaces a short macro/tag summary under each item. */
function SkeletonCard({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-md border border-border/40 p-3",
        className,
      )}
      aria-hidden
      {...props}
    >
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

/** Single horizontal bar, used by Pantry-style flat lists. Full
 *  width, fixed height. */
function SkeletonRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Skeleton
      className={cn("h-9 w-full", className)}
      {...props}
    />
  );
}

export { Skeleton, SkeletonCard, SkeletonListRow, SkeletonRow };
