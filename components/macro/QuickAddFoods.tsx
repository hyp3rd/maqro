"use client";

import { useFavoriteFoods } from "@/hooks/use-favorite-foods";
import { useRecentFoods } from "@/hooks/use-recent-foods";
import type { RecentSort } from "@/lib/recent-foods";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";
import { Plus, Star } from "lucide-react";
import type { Food } from "./types";

/** The three sources the quick-add card switches between. `recent` and
 *  `frequent` are the same logged foods under a different sort; `favorites`
 *  is the explicitly-pinned list. */
type QuickAddTab = "recent" | "frequent" | "favorites";

const TABS: QuickAddTab[] = ["recent", "frequent", "favorites"];

/** A single bounded "Quick add" card shared by the food-search empty state
 *  and the Log-meal method step. One segmented control switches the source
 *  (Recent · Frequent · Favorites); the active list scrolls inside a fixed
 *  height so the card never grows into a wall. Each row one-tap re-adds at
 *  its last portion via `onAdd`, with a star to pin/unpin (synced). Renders
 *  nothing until loaded; when there's nothing to surface, `emptyFallback`
 *  shows instead. */
export function QuickAddFoods({
  onAdd,
  emptyFallback,
}: {
  onAdd: (food: Food, portion: number) => void;
  emptyFallback?: ReactNode;
}) {
  const [tab, setTab] = useState<QuickAddTab>("recent");
  // `favorites` doesn't re-sort the recents read; keep it on "recent".
  const recentSort: RecentSort = tab === "frequent" ? "frequent" : "recent";
  const { recents, loaded } = useRecentFoods({ limit: 12, sort: recentSort });
  const { favorites, isFavorite, toggle } = useFavoriteFoods();

  if (!loaded) return null;

  // With no recents and no favorites, defer to the caller's fallback
  // (e.g. the search sheet's "start typing" hint).
  if (recents.length === 0 && favorites.length === 0) {
    return <>{emptyFallback ?? null}</>;
  }

  const isFav = tab === "favorites";
  const rows = isFav
    ? favorites.map((f) => ({
        key: f.id,
        food: f.food,
        portion: f.portion,
        count: undefined as number | undefined,
      }))
    : recents.map((r) => ({
        key: r.name,
        food: r.food,
        portion: r.lastPortion,
        count: r.count,
      }));

  return (
    <section className="space-y-2.5 rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Quick add source"
          className="inline-flex items-center rounded-md border border-border/60 p-0.5 text-[11px]"
        >
          {TABS.map((opt) => (
            <button
              key={opt}
              type="button"
              role="tab"
              onClick={() => setTab(opt)}
              aria-selected={tab === opt}
              className={cn(
                "rounded px-2.5 py-0.5 font-medium capitalize transition-colors",
                tab === opt
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="max-h-64 overflow-y-auto">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {rows.map((row) => (
              <FoodRow
                key={row.key}
                name={row.food.name}
                kcal={Math.round((row.food.calories * row.portion) / 100)}
                portion={row.portion}
                count={row.count}
                favorited={isFavorite(row.food.name)}
                onAdd={() => onAdd(row.food, row.portion)}
                onToggleFavorite={() => void toggle(row.food, row.portion)}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="px-1 py-5 text-center text-xs text-muted-foreground">
          {isFav
            ? "No favorites yet — tap the ☆ on any food to pin it."
            : "No recent foods yet — they'll show up here as you log."}
        </p>
      )}
    </section>
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
        aria-label={favorited ? `Unfavorite ${name}` : `Favorite ${name}`}
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
