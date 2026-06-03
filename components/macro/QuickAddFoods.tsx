"use client";

import { useFavoriteFoods } from "@/hooks/use-favorite-foods";
import { useRecentFoods } from "@/hooks/use-recent-foods";
import type { RecentSort } from "@/lib/recent-foods";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";
import { Plus, Star } from "lucide-react";
import type { Food } from "./types";

const SORTS: RecentSort[] = ["recent", "frequent"];

/** Quick-add list shared by the food-search empty state and the meal hub:
 *  starred Favourites pinned at the top, then the user's recent / frequent
 *  foods (Recent⇄Frequent toggle). Each row one-tap re-adds at its last
 *  portion via `onAdd`, with a star to pin/unpin (synced). Renders nothing
 *  until loaded; `emptyFallback` shows when there's nothing to surface. */
export function QuickAddFoods({
  onAdd,
  emptyFallback,
}: {
  onAdd: (food: Food, portion: number) => void;
  emptyFallback?: ReactNode;
}) {
  const [sort, setSort] = useState<RecentSort>("recent");
  const { recents, loaded } = useRecentFoods({ limit: 12, sort });
  const { favorites, isFavorite, toggle } = useFavoriteFoods();

  if (!loaded) return null;
  if (recents.length === 0 && favorites.length === 0) {
    return <>{emptyFallback ?? null}</>;
  }

  return (
    <div className="space-y-3">
      {favorites.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Favourites
          </h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {favorites.map((f) => (
              <FoodRow
                key={f.id}
                name={f.food.name}
                kcal={Math.round((f.food.calories * f.portion) / 100)}
                portion={f.portion}
                favorited
                onAdd={() => onAdd(f.food, f.portion)}
                onToggleFavorite={() => void toggle(f.food, f.portion)}
              />
            ))}
          </div>
        </section>
      )}

      {recents.length > 0 && (
        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quick add
            </h3>
            <div className="inline-flex items-center rounded-md border border-border/60 p-0.5 text-[11px]">
              {SORTS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setSort(opt)}
                  aria-pressed={sort === opt}
                  className={cn(
                    "rounded px-2 py-0.5 font-medium capitalize transition-colors",
                    sort === opt
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {recents.map((r) => (
              <FoodRow
                key={r.name}
                name={r.name}
                kcal={Math.round((r.food.calories * r.lastPortion) / 100)}
                portion={r.lastPortion}
                count={r.count}
                favorited={isFavorite(r.name)}
                onAdd={() => onAdd(r.food, r.lastPortion)}
                onToggleFavorite={() => void toggle(r.food, r.lastPortion)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** A single quick-add row: a tap-to-add area + a separate star toggle.
 *  Two sibling buttons (not nested) so the markup stays valid. */
function FoodRow({
  name,
  kcal,
  portion,
  count,
  favorited,
  onAdd,
  onToggleFavorite,
}: {
  name: string;
  kcal: number;
  portion: number;
  count?: number;
  favorited: boolean;
  onAdd: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="flex items-center rounded-lg border border-border/60 bg-card pr-1 transition-colors hover:bg-accent/40">
      <button
        type="button"
        onClick={onAdd}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left active:bg-muted"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {name}
          </span>
          <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
            {kcal} kcal · {portion} g
            {count !== undefined && count > 1 && (
              <span className="ml-1 text-muted-foreground/60">· ×{count}</span>
            )}
          </span>
        </span>
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={favorited ? `Unfavourite ${name}` : `Favourite ${name}`}
        aria-pressed={favorited}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        <Star
          className={cn(
            "h-4 w-4",
            favorited && "fill-amber-400 text-amber-500",
          )}
        />
      </button>
    </div>
  );
}
