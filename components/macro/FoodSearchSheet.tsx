"use client";

import { useFoodSearch } from "@/hooks/use-food-search";
import { useModalOverlay } from "@/hooks/use-modal-overlay";
import {
  DEFAULT_GRAMS,
  PORTION_PRESETS,
  SOURCE_LABEL,
  addedFoodMessage,
} from "@/lib/add-food-constants";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Loader2, Minus, Plus, Search } from "lucide-react";
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

function clampGrams(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(2000, n));
}

function foodKey(food: Food): string {
  return food.id ?? food.name;
}

/** Full-screen food search launched from the guided Log-meal flow. Picking a
 *  result expands a portion editor INLINE under that row (presets + stepper +
 *  live macros) instead of bouncing to a separate screen, so the search box
 *  stays in view and adding a few foods in a row stays in one place. */
export function FoodSearchSheet({
  open,
  onOpenChange,
  mealId,
  mealName,
  customFoodsRev,
  onLogFood,
  onBack,
}: Props) {
  // Scroll-lock, Escape, focus trap + restore — the shared overlay contract.
  // The search Input's autoFocus wins the initial focus (the hook honors it).
  const containerRef = useRef<HTMLDivElement>(null);
  useModalOverlay(open, containerRef, () => onOpenChange(false));

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Add food to ${mealName}`}
      // Full-screen on mobile; a centered, bounded modal on desktop (sm+) so the
      // list isn't a small panel floating in a black void.
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
  // The expanded result (its key) + the grams in its inline editor.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [grams, setGrams] = useState(DEFAULT_GRAMS);
  const search = useFoodSearch(query, customFoodsRev);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /** Log a food, toast, and collapse the editor. Shared by the inline Add
   *  button (current grams), the per-row quick "+" (editor grams when open,
   *  100 g otherwise), and QuickAddFoods (a recent food's last portion). */
  function logFood(food: Food, portion: number) {
    if (mealId === null || portion < 1) return;
    // Inline add (Enter / "Add Xg") unmounts the editor with keyboard focus
    // inside it, which would strand focus on <body> mid-list. Return it to
    // the search box — the flow is search → add → search the next. Scoped to
    // the inline path so the quick "+" and recents keep focus in place for
    // repeat adds.
    const wasInlineAdd = openKey === foodKey(food);
    onLogFood(food, mealId, portion);
    const kcal = Math.round((food.calories * portion) / 100);
    toast.success(addedFoodMessage(food.name, portion, kcal, mealName));
    setOpenKey(null);
    if (wasInlineAdd) searchInputRef.current?.focus();
  }

  function toggleRow(food: Food) {
    const key = foodKey(food);
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    setGrams(DEFAULT_GRAMS);
  }

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
            Your foods plus millions of branded and generic items.
          </p>
        </div>
        <MarketSwitcher />
      </header>

      <div className="border-b border-border/60 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenKey(null);
            }}
            placeholder="Search for a food…"
            className="h-12 pl-9 pr-9 text-base"
            autoFocus
          />
          {search.isSearchingRemote && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {search.results.map((food) => {
          const open = openKey === foodKey(food);
          return (
            <ResultRow
              key={food.id ?? food.name}
              food={food}
              open={open}
              grams={open ? grams : DEFAULT_GRAMS}
              onToggle={() => toggleRow(food)}
              // With the row's editor open, the quick "+" honors the chosen
              // grams — otherwise tapping it right after picking "50 g" would
              // silently log 100 g. Closed rows keep the one-tap 100 g default.
              onQuickAdd={() => logFood(food, open ? grams : DEFAULT_GRAMS)}
              onSetGrams={(g) => setGrams(g)}
              onAdd={() => logFood(food, grams)}
            />
          );
        })}

        {query.trim() === "" && mealId !== null && (
          <QuickAddFoods
            onAdd={(food, portion) => logFood(food, portion)}
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

function ResultRow({
  food,
  open,
  grams,
  onToggle,
  onQuickAdd,
  onSetGrams,
  onAdd,
}: {
  food: Food;
  open: boolean;
  grams: number;
  onToggle: () => void;
  onQuickAdd: () => void;
  onSetGrams: (grams: number) => void;
  onAdd: () => void;
}) {
  const scale = (per100: number) =>
    Number.parseFloat(((per100 * grams) / 100).toFixed(1));
  const kcal = Math.round((food.calories * grams) / 100);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card transition-colors",
        open ? "border-primary/50" : "border-border/60",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          // Only one editor is open at a time, so a single fixed id links
          // every toggle to it; closed rows reference nothing.
          aria-controls={open ? "food-portion-editor" : undefined}
          className="min-w-0 flex-1 text-left"
        >
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
            {Math.round(food.calories)} kcal · P{food.protein.toFixed(0)} · C
            {food.carbs.toFixed(0)} · F{food.fat.toFixed(0)}
            <span className="ml-1 text-muted-foreground/60">/ 100g</span>
          </span>
        </button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onQuickAdd}
          disabled={grams < 1}
          aria-label={`Add ${grams} g of ${food.name}`}
          title={`Add ${grams} g`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {open && (
        <div
          id="food-portion-editor"
          className="space-y-3 border-t border-border/60 px-3 py-3"
        >
          <p className="flex flex-wrap items-center gap-x-2 font-mono text-xs tabular-nums">
            <span className="font-semibold text-foreground">{kcal} kcal</span>
            <span className="text-muted-foreground/40">·</span>
            <span style={{ color: "hsl(var(--macro-protein))" }}>
              P{scale(food.protein)}
            </span>
            <span style={{ color: "hsl(var(--macro-carbs))" }}>
              C{scale(food.carbs)}
            </span>
            <span style={{ color: "hsl(var(--macro-fat))" }}>
              F{scale(food.fat)}
            </span>
          </p>

          <div className="flex flex-wrap gap-1.5">
            {PORTION_PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onSetGrams(g)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                  grams === g
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 text-muted-foreground active:bg-muted",
                )}
              >
                {g} g
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => onSetGrams(clampGrams(grams - 5))}
              aria-label="Decrease by 5 grams"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              inputMode="numeric"
              value={grams}
              onChange={(e) =>
                onSetGrams(clampGrams(Number.parseInt(e.target.value, 10)))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") onAdd();
              }}
              className="h-10 w-20 text-center font-mono tabular-nums"
              min="1"
              max="2000"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => onSetGrams(clampGrams(grams + 5))}
              aria-label="Increase by 5 grams"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              className="h-10 flex-1 gap-1.5"
              disabled={grams < 1}
              onClick={onAdd}
            >
              <Plus className="h-4 w-4" />
              Add {grams} g
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
