"use client";

import { useFoodSearch } from "@/hooks/use-food-search";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MarketSwitcher } from "./MarketSwitcher";
import { QuickAddFoods } from "./QuickAddFoods";
import type { Food } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Target meal the resolved food is logged to. */
  mealId: number | null;
  mealName: string;
  /** Forwarded to useFoodSearch so freshly-saved custom foods appear. */
  customFoodsRev: number;
  onLogFood: (food: Food, mealId: number, grams: number) => void;
  /** Return to the previous step (the guided Log-meal method picker)
   *  rather than closing outright. */
  onBack: () => void;
};

const SOURCE_LABEL: Record<NonNullable<Food["source"]>, string> = {
  builtin: "Built-in",
  custom: "My food",
  off: "Open Food Facts",
  ciqual: "CIQUAL",
};

/** Full-screen food search — the "Search foods" tool launched from the
 *  guided Log-meal flow. Full-viewport (portal, `fixed inset-0`) with a
 *  pinned header + search box and a scroll area for results, so the
 *  layout never resizes as results stream in (the cramped, growing
 *  bottom-sheet was the complaint this replaces). Mirrors CameraSheet's
 *  full-screen pattern for consistency. */
export function FoodSearchSheet({
  open,
  onOpenChange,
  mealId,
  mealName,
  customFoodsRev,
  onLogFood,
  onBack,
}: Props) {
  // Body-scroll lock + Escape-to-close while open, matching CameraSheet.
  useEffect(() => {
    if (!open) return;
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const prevHtml = htmlEl.style.overflow;
    const prevBody = bodyEl.style.overflow;
    htmlEl.style.overflow = "hidden";
    bodyEl.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      htmlEl.style.overflow = prevHtml;
      bodyEl.style.overflow = prevBody;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add food to ${mealName}`}
      // Full-screen on mobile (the guided flow this was built for). On desktop
      // (sm+) a full-bleed layout is a small list floating in a black void, so
      // it becomes a centered, bounded modal over a dimmed backdrop — matching
      // the meal hub it's launched from. The inner panel sizes to its content
      // (short for the portion step, up to 85vh + scroll for the results).
      className="fixed inset-0 z-[60] flex flex-col bg-background pt-safe sm:items-center sm:justify-center sm:bg-black/70 sm:p-6"
    >
      <div className="flex min-h-0 flex-1 flex-col sm:max-h-[85vh] sm:w-full sm:max-w-2xl sm:flex-none sm:overflow-hidden sm:rounded-2xl sm:border sm:border-border/60 sm:bg-background sm:shadow-2xl">
        <FoodSearchBody
          mealId={mealId}
          mealName={mealName}
          customFoodsRev={customFoodsRev}
          onLogFood={onLogFood}
          onBack={onBack}
        />
      </div>
    </div>,
    document.body,
  );
}

function FoodSearchBody({
  mealId,
  mealName,
  customFoodsRev,
  onLogFood,
  onBack,
}: {
  mealId: number | null;
  mealName: string;
  customFoodsRev: number;
  onLogFood: (food: Food, mealId: number, grams: number) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Food | null>(null);
  const [grams, setGrams] = useState(100);
  const search = useFoodSearch(query, customFoodsRev);

  function handleAdd() {
    if (picked === null || mealId === null) return;
    onLogFood(picked, mealId, grams);
    const kcal = Math.round((picked.calories * grams) / 100);
    toast.success(
      `Added ${picked.name} (${grams} g, ${kcal} kcal) to ${mealName}`,
    );
    // Stay open to log more — clear the picked food + query.
    setPicked(null);
    setQuery("");
  }

  /** One-tap re-add of a recent food at its last portion — the quick path
   *  that skips the portion step entirely. Reuses the same log path (and
   *  toast shape) as `handleAdd`. */
  function quickAdd(food: Food, portion: number) {
    if (mealId === null) return;
    onLogFood(food, mealId, portion);
    const kcal = Math.round((food.calories * portion) / 100);
    toast.success(
      `Added ${food.name} (${portion} g, ${kcal} kcal) to ${mealName}`,
    );
  }

  function bumpGrams(delta: number) {
    setGrams((g) => Math.max(1, Math.min(2000, g + delta)));
  }

  const pickedKcal = picked ? Math.round((picked.calories * grams) / 100) : 0;
  const scale = (per100: number) =>
    Number.parseFloat(((per100 * grams) / 100).toFixed(1));

  // --- Portion step: replaces the search list once a food is chosen. ---
  if (picked) {
    return (
      <>
        <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
          <button
            type="button"
            onClick={() => setPicked(null)}
            aria-label="Back to search"
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors active:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {picked.name}
            </p>
            <p className="text-xs text-muted-foreground">
              Logging to {mealName}
            </p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
          <p className="flex flex-wrap items-center gap-x-2 font-mono text-sm tabular-nums">
            <span className="text-foreground">{pickedKcal} kcal</span>
            <span className="text-muted-foreground/50">·</span>
            <span style={{ color: "hsl(var(--macro-protein))" }}>
              P{scale(picked.protein)}
            </span>
            <span style={{ color: "hsl(var(--macro-carbs))" }}>
              C{scale(picked.carbs)}
            </span>
            <span style={{ color: "hsl(var(--macro-fat))" }}>
              F{scale(picked.fat)}
            </span>
          </p>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Portion (grams)
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => bumpGrams(-5)}
                aria-label="Decrease portion by 5 grams"
              >
                <Minus className="h-5 w-5" />
              </Button>
              <Input
                type="number"
                inputMode="numeric"
                value={grams}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  setGrams(
                    Number.isNaN(n) ? 0 : Math.max(0, Math.min(2000, n)),
                  );
                }}
                className="h-12 flex-1 text-center font-mono text-lg tabular-nums"
                min="1"
                max="2000"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => bumpGrams(5)}
                aria-label="Increase portion by 5 grams"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-border/60 px-4 py-3 pb-safe-plus-2">
          <Button
            type="button"
            className="h-12 w-full gap-1.5"
            disabled={grams < 1 || mealId === null}
            onClick={handleAdd}
          >
            <Plus className="h-4 w-4" />
            Add to {mealName}
          </Button>
        </div>
      </>
    );
  }

  // --- Search step: pinned header + input, scrolling results. ---
  return (
    <>
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors active:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Add to {mealName}
          </p>
          <p className="text-xs text-muted-foreground">
            Your foods, the built-in database, CIQUAL, and Open Food Facts.
          </p>
        </div>
        <MarketSwitcher />
      </header>

      <div className="border-b border-border/60 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a food…"
            className="h-12 pl-9 pr-9 text-base"
            autoFocus
          />
          {search.isSearchingRemote && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {search.results.map((food) => (
          <button
            key={food.id ?? food.name}
            type="button"
            onClick={() => {
              setPicked(food);
              setGrams(100);
            }}
            className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 text-left transition-colors active:bg-muted"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {food.name}
                </span>
                {food.source && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {SOURCE_LABEL[food.source]}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground">
                {Math.round(food.calories)} kcal · P{food.protein.toFixed(0)} ·
                C{food.carbs.toFixed(0)} · F{food.fat.toFixed(0)}
                <span className="ml-1 text-muted-foreground/60">/ 100g</span>
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          </button>
        ))}

        {query.trim() === "" && mealId !== null && (
          <QuickAddFoods
            onAdd={quickAdd}
            emptyFallback={
              <p className="px-1 py-10 text-center text-sm text-muted-foreground">
                Start typing to search foods.
              </p>
            }
          />
        )}
        {query.trim() !== "" &&
          search.results.length === 0 &&
          !search.isSearchingRemote && (
            <p className="px-1 py-10 text-center text-sm text-muted-foreground">
              No matches for “{query.trim()}”.
            </p>
          )}
      </div>
    </>
  );
}
