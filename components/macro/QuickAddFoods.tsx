"use client";

import { useFavoriteFoods } from "@/hooks/use-favorite-foods";
import {
  useRecentFoods,
  useRecentFoodsForSlot,
} from "@/hooks/use-recent-foods";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";
import { Plus, Star } from "lucide-react";
import type { Food } from "./types";

type Props = {
  onAdd: (food: Food, portion: number) => void;
  emptyFallback?: ReactNode;
  /** When set, the card switches to slot-scoped "Log this again" mode: the
   *  foods most often logged to THIS meal slot, no source tabs. Absent → the
   *  tabbed Recent · Favorites card (used by the search empty state + the
   *  guided launcher's method step). */
  slotName?: string;
};

/** A bounded one-tap re-add card. Two modes:
 *    - slot mode (`slotName` set) → a "Log this again" list scoped to that meal
 *      slot, the dominant "I eat the same breakfast" path in two taps;
 *    - tabbed mode → Recent · Favorites (Frequent was dropped: it read the same
 *      recents source re-sorted, a distinction without a usable difference).
 *  Each row re-adds at its last portion via `onAdd`, with a synced ☆ to pin. */
export function QuickAddFoods({ onAdd, emptyFallback, slotName }: Props) {
  return slotName && slotName.trim() ? (
    <SlotQuickAdd
      slotName={slotName}
      onAdd={onAdd}
      emptyFallback={emptyFallback}
    />
  ) : (
    <TabbedQuickAdd
      onAdd={onAdd}
      emptyFallback={emptyFallback}
    />
  );
}

type Row = {
  key: string;
  food: Food;
  portion: number;
  count?: number;
  fromOtherSlot?: boolean;
};

/** Slot-scoped "Log this again" — the foods most recently logged to this slot,
 *  topped up from global recents when the slot's own history is sparse. */
function SlotQuickAdd({
  slotName,
  onAdd,
  emptyFallback,
}: {
  slotName: string;
  onAdd: (food: Food, portion: number) => void;
  emptyFallback?: ReactNode;
}) {
  const { recents, loaded } = useRecentFoodsForSlot(slotName, { limit: 12 });
  const { isFavorite, toggle } = useFavoriteFoods();

  if (!loaded) return null;
  if (recents.length === 0) return <>{emptyFallback ?? null}</>;

  const rows: Row[] = recents.map((r) => ({
    key: r.name,
    food: r.food,
    portion: r.lastPortion,
    count: r.count,
    fromOtherSlot: r.fromOtherSlot,
  }));

  return (
    <Card>
      <p className="text-xs font-semibold text-foreground">Log this again</p>
      <RowsGrid
        rows={rows}
        onAdd={onAdd}
        isFavorite={isFavorite}
        onToggleFavorite={toggle}
      />
    </Card>
  );
}

const TABS = ["recent", "favorites"] as const;
type QuickAddTab = (typeof TABS)[number];

/** The tabbed Recent · Favorites card for the search empty state + launcher. */
function TabbedQuickAdd({
  onAdd,
  emptyFallback,
}: {
  onAdd: (food: Food, portion: number) => void;
  emptyFallback?: ReactNode;
}) {
  const [tab, setTab] = useState<QuickAddTab>("recent");
  const { recents, loaded } = useRecentFoods({ limit: 12 });
  const { favorites, isFavorite, toggle } = useFavoriteFoods();

  if (!loaded) return null;

  // With no recents and no favorites, defer to the caller's fallback
  // (e.g. the search sheet's "start typing" hint).
  if (recents.length === 0 && favorites.length === 0) {
    return <>{emptyFallback ?? null}</>;
  }

  const isFav = tab === "favorites";
  const rows: Row[] = isFav
    ? favorites.map((f) => ({ key: f.id, food: f.food, portion: f.portion }))
    : recents.map((r) => ({
        key: r.name,
        food: r.food,
        portion: r.lastPortion,
        count: r.count,
      }));

  return (
    <Card>
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
        <RowsGrid
          rows={rows}
          onAdd={onAdd}
          isFavorite={isFavorite}
          onToggleFavorite={toggle}
        />
      ) : (
        <p className="px-1 py-5 text-center text-xs text-muted-foreground">
          {isFav
            ? "No favorites yet — tap the ☆ on any food to pin it."
            : "No recent foods yet — they'll show up here as you log."}
        </p>
      )}
    </Card>
  );
}

/** The bounded card shell shared by both modes. */
function Card({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-xl border border-border/60 bg-card/40 p-3">
      {children}
    </section>
  );
}

/** The scrolling grid of one-tap rows, shared by both modes. */
function RowsGrid({
  rows,
  onAdd,
  isFavorite,
  onToggleFavorite,
}: {
  rows: Row[];
  onAdd: (food: Food, portion: number) => void;
  isFavorite: (name: string) => boolean;
  onToggleFavorite: (food: Food, portion: number) => void | Promise<void>;
}) {
  return (
    <div className="max-h-64 overflow-y-auto">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {rows.map((row) => (
          <FoodRow
            key={row.key}
            name={row.food.name}
            kcal={Math.round((row.food.calories * row.portion) / 100)}
            portion={row.portion}
            count={row.count}
            fromOtherSlot={row.fromOtherSlot}
            favorited={isFavorite(row.food.name)}
            onAdd={() => onAdd(row.food, row.portion)}
            onToggleFavorite={() =>
              void onToggleFavorite(row.food, row.portion)
            }
          />
        ))}
      </div>
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
  fromOtherSlot,
  favorited,
  onAdd,
  onToggleFavorite,
}: {
  name: string;
  kcal: number;
  portion: number;
  count?: number;
  fromOtherSlot?: boolean;
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
            {/* The "×N" count is slot-scoped, so it's only meaningful on a
                slot-native row. A backfilled row carries its GLOBAL count, which
                would mislabel a cross-slot staple as frequent HERE — show the
                "· recent" marker instead so it doesn't read as a slot staple. */}
            {count !== undefined && count > 1 && !fromOtherSlot && (
              <span className="ml-1 text-muted-foreground/60">· ×{count}</span>
            )}
            {fromOtherSlot && (
              <span className="ml-1 text-muted-foreground/60">· recent</span>
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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground coarse:h-11 coarse:w-11"
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
