"use client";

import type { DietPreference, Recipe } from "@/components/macro/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listRecipes } from "@/lib/db";
import { recipeDietCompatibility } from "@/lib/diet";
import { extraDatesFromToday } from "@/lib/meal-prep-batch";
import { rankRecipesByFit, type SlotBudget } from "@/lib/recipe-ranking";
import { scaleRecipeIngredients } from "@/lib/scale-recipe";
import { reportStorageError } from "@/lib/storage-status";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  ChefHat,
  ChevronLeft,
  Eye,
  Minus,
  Plus,
} from "lucide-react";
import { ServingsStepper } from "./ServingsStepper";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name for the target meal slot (e.g. "Breakfast"). */
  targetMealName: string;
  /** Filter the recipe list down to ones compatible with this diet, so a
   *  vegan user doesn't see chicken-stir-fry suggestions. */
  dietPreference?: DietPreference;
  /** Macro headroom for this slot, derived by the caller from
   *  `dailyTarget / mealSlots`. When supplied, the recipe list is
   *  sorted by per-serving fit (lower distance to budget = first) and
   *  the top entry gets a "Best fit" badge. Omit when no usable
   *  target exists (e.g. user hasn't filled the profile yet) — the
   *  dialog falls back to natural IDB order. */
  slotBudget?: SlotBudget;
  /** Apply the picked recipe. `extraDates` is the meal-prep batch
   *  payload — empty / undefined means "today only" (the original
   *  single-apply path). When populated, the caller should write the
   *  same scaled ingredients to the same-named slot on each date. */
  onApply: (recipe: Recipe, extraDates?: string[]) => void;
  /** When provided, the header shows a back affordance returning to the
   *  previous step (the guided Log-meal method picker). Omitted when the
   *  dialog is opened standalone from a meal's menu. */
  onBack?: () => void;
};

export function ApplyRecipeDialog({
  open,
  onOpenChange,
  targetMealName,
  dietPreference,
  slotBudget,
  onApply,
  onBack,
}: Props) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  // Global servings multiplier applied to whichever recipe gets
  // picked. Single stepper at the top - discoverable, doesn't get
  // in the way of the one-click apply for the common 1× case, and
  // doesn't require a second confirm step.
  const [scale, setScale] = useState(1);
  // Meal-prep batch: how many consecutive days (today + N-1 future
  // days) the chosen recipe writes to. 1 = today only, the original
  // single-apply behavior. Capped at 7 to match the helper.
  const [days, setDays] = useState(1);
  // Reset the steppers between opens using the "set state during
  // render on prop change" pattern. setState-in-effect would have
  // been the obvious place but it trips the
  // react-hooks/set-state-in-effect rule; setState during render is
  // the project's sanctioned escape hatch for "react to an external
  // prop change" - React discards the in-progress render and
  // immediately re-renders with the new state.
  const [prevOpen, setPrevOpen] = useState(open);
  // Which recipe's ingredient preview is expanded inline (the quick
  // view). `null` = none expanded.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setScale(1);
      setDays(1);
      setExpandedId(null);
    }
  }
  const loading = open && recipes === null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listRecipes()
      .then((rows) => {
        if (!cancelled) setRecipes(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setRecipes([]);
      });
    return () => {
      cancelled = true;
      setRecipes(null);
    };
  }, [open]);

  const filtered = recipes
    ? recipes.filter(
        (r) =>
          !dietPreference || recipeDietCompatibility(r).has(dietPreference),
      )
    : [];
  // Rank by per-serving fit when a slot budget is supplied. The
  // helper preserves natural order when there's no usable budget,
  // so this is safe to run unconditionally.
  const ranked = rankRecipesByFit(filtered, slotBudget);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent active:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <DialogHeader>
          <DialogTitle>Apply recipe</DialogTitle>
          <DialogDescription>
            Apply a saved recipe to <strong>{targetMealName}</strong>. Its
            ingredients will be appended as individual foods you can still
            adjust.
          </DialogDescription>
        </DialogHeader>

        {/* Servings + days steppers. Always visible above the list
         *  (even when empty) so the user sees both affordances and
         *  knows they can scale + batch before picking - discovering
         *  either after the apply happened would be too late.
         *
         *  Days = 1 keeps the original single-apply behavior. Bumping
         *  it copies the chosen recipe to the same-named slot on the
         *  next N-1 consecutive days — the "cook once, log for the
         *  week" flow. Stepper goes 1..7. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-border/60 py-2">
          <ServingsStepper
            value={scale}
            onChange={setScale}
          />
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              Days
            </span>
            <div className="inline-flex h-9 items-center rounded-md border border-border/60 bg-background">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-none rounded-l-md"
                onClick={() => setDays((d) => Math.max(1, d - 1))}
                disabled={days <= 1}
                aria-label="Decrease days"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span
                aria-live="polite"
                className="min-w-[3.5ch] px-2 text-center font-mono text-sm tabular-nums"
              >
                {days}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-none rounded-r-md"
                onClick={() => setDays((d) => Math.min(7, d + 1))}
                disabled={days >= 7}
                aria-label="Increase days"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {(scale !== 1 || days > 1) && (
            <span className="basis-full text-[11px] text-muted-foreground">
              {scale !== 1 &&
                `Each portion × ${scale.toFixed(2).replace(/\.?0+$/, "")}`}
              {scale !== 1 && days > 1 && " · "}
              {days > 1 &&
                `Writes to ${targetMealName} on ${days} consecutive days starting today`}
            </span>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {loading ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              Loading…
            </p>
          ) : ranked.length === 0 ? (
            <div className="px-1 py-6 text-center">
              <ChefHat className="mx-auto h-5 w-5 text-muted-foreground/60" />
              <p className="mt-2 text-xs text-muted-foreground">
                {recipes && recipes.length === 0
                  ? "No recipes saved yet. Open the Recipes view to create one."
                  : `No recipes match the ${dietPreference} diet preference.`}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {ranked.map((entry, index) => {
                const r = entry.recipe;
                // The "Best fit" badge only makes sense when the
                // ranking is meaningful (a scored top entry) AND
                // there's actually competition (>1 recipe). With one
                // recipe, "Best fit" is noise.
                const showBestFit =
                  index === 0 &&
                  ranked.length > 1 &&
                  entry.fitScore !== undefined;
                return (
                  <li
                    key={r.id}
                    className="px-1 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          // Scale the ingredients by the current
                          // multiplier before handing to onApply. The
                          // caller treats the scaled ingredients the
                          // same as the unscaled ones - same shape,
                          // just bigger/smaller portionGrams. The 1×
                          // path short-circuits to a no-op clone, so
                          // there's no cost for the common case.
                          const scaled: Recipe = {
                            ...r,
                            ingredients: scaleRecipeIngredients(
                              r.ingredients,
                              scale,
                            ),
                          };
                          // Compute the batch dates fresh at click time
                          // (not when the stepper changed) so a slow
                          // user reading recipe metadata doesn't trip
                          // the day rollover edge case. `extraDates`
                          // is undefined for the today-only case; the
                          // caller can treat that as the existing
                          // single-day path.
                          const extras = extraDatesFromToday(days, new Date());
                          onApply(
                            scaled,
                            extras.length > 0 ? extras : undefined,
                          );
                          onOpenChange(false);
                        }}
                        className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {r.name}
                          </span>
                          {showBestFit && (
                            <Badge className="shrink-0 border-amber-500/30 bg-amber-500/10 text-[10px] font-normal text-amber-700 dark:text-amber-300">
                              Best fit
                            </Badge>
                          )}
                          {r.cuisine && (
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[10px] font-normal"
                            >
                              {r.cuisine}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {r.ingredients.length} ingredient
                          {r.ingredients.length === 1 ? "" : "s"} ·{" "}
                          {Math.round(entry.perServing.calories)} kcal · P
                          {Math.round(entry.perServing.protein)} · C
                          {Math.round(entry.perServing.carbs)} · F
                          {Math.round(entry.perServing.fat)}
                          {r.servings && r.servings > 1
                            ? ` (per serving of ${r.servings})`
                            : ""}
                        </div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground sm:h-8 sm:w-8"
                        onClick={() =>
                          setExpandedId((id) => (id === r.id ? null : r.id))
                        }
                        aria-expanded={expandedId === r.id}
                        aria-label={`Preview ${r.name}`}
                      >
                        <Eye className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </Button>
                    </div>

                    {expandedId === r.id && (
                      <ul className="mt-2 space-y-1 rounded-md bg-muted/40 px-3 py-2">
                        {r.ingredients.map((ing, i) => (
                          <li
                            key={`${ing.foodName}-${i}`}
                            className="flex items-baseline justify-between gap-3 text-[11px]"
                          >
                            <span className="min-w-0 truncate text-foreground">
                              {ing.foodName}
                            </span>
                            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                              {Math.round(ing.portionGrams * scale)} g
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
