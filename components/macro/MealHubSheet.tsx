"use client";

import { useRecentFoods } from "@/hooks/use-recent-foods";
import { useState } from "react";
import { LayoutGrid, Plus, Search, Soup, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { FoodSearchSheet } from "./FoodSearchSheet";
import { MealDetail, type DailyGoal } from "./MealDetailSheet";
import type { Food, Meal } from "./types";

type Props = {
  /** The meal the hub is open for. `null` = closed. */
  meal: Meal | null;
  goal?: DailyGoal;
  /** Forwarded to the stacked food-search sheet so fresh custom foods appear. */
  customFoodsRev: number;
  /** Same add path a search pick uses — scales, draws down the pantry, persists,
   *  toasts. */
  onLogFood: (food: Food, mealId: number, grams: number) => void;
  onRemoveFood: (mealId: number, foodId: number) => void;
  onAddFromTemplate: (mealId: number) => void;
  onApplyRecipe: (mealId: number) => void;
  onRegenerate: (mealId: number) => void;
  regenerating: boolean;
  regeneratingThisMeal: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Per-meal hub you "step into" from a meal card: quick-add recents (one tap
 *  to this meal), full search, the meal's current foods, and the existing
 *  insights + AI advice (the reused `MealDetail`). Opened via the meal's
 *  "Quick add" chip or its "Insights" badge — both set the same
 *  `mealDetailId`; the empty-vs-populated difference is handled inside. */
export function MealHubSheet({
  meal,
  goal,
  customFoodsRev,
  onLogFood,
  onRemoveFood,
  onAddFromTemplate,
  onApplyRecipe,
  onRegenerate,
  regenerating,
  regeneratingThisMeal,
  onOpenChange,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <Dialog
        open={meal !== null}
        // Drop the focus trap while the full-screen search sheet is stacked
        // on top, so its input can hold focus past this dialog's trap. The
        // search sheet covers the viewport, so non-modal is safe here.
        modal={!searchOpen}
        onOpenChange={onOpenChange}
      >
        <DialogContent className="max-h-[88vh] gap-3 overflow-y-auto">
          {meal && (
            <MealHubBody
              key={meal.id}
              meal={meal}
              goal={goal}
              onLogFood={onLogFood}
              onRemoveFood={onRemoveFood}
              onAddFromTemplate={onAddFromTemplate}
              onApplyRecipe={onApplyRecipe}
              onRegenerate={onRegenerate}
              regenerating={regenerating}
              regeneratingThisMeal={regeneratingThisMeal}
              onOpenSearch={() => setSearchOpen(true)}
              onClose={() => onOpenChange(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {meal && (
        <FoodSearchSheet
          open={searchOpen}
          onOpenChange={setSearchOpen}
          mealId={meal.id}
          mealName={meal.name}
          customFoodsRev={customFoodsRev}
          onLogFood={onLogFood}
          onBack={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}

function MealHubBody({
  meal,
  goal,
  onLogFood,
  onRemoveFood,
  onAddFromTemplate,
  onApplyRecipe,
  onRegenerate,
  regenerating,
  regeneratingThisMeal,
  onOpenSearch,
  onClose,
}: {
  meal: Meal;
  goal?: DailyGoal;
  onLogFood: (food: Food, mealId: number, grams: number) => void;
  onRemoveFood: (mealId: number, foodId: number) => void;
  onAddFromTemplate: (mealId: number) => void;
  onApplyRecipe: (mealId: number) => void;
  onRegenerate: (mealId: number) => void;
  regenerating: boolean;
  regeneratingThisMeal: boolean;
  onOpenSearch: () => void;
  onClose: () => void;
}) {
  const { recents } = useRecentFoods(8);
  const hasFoods = meal.foods.length > 0;
  const totalKcal = Math.round(meal.foods.reduce((s, f) => s + f.calories, 0));

  /** One-tap re-add of a recent food at its last portion. */
  function quickAdd(food: Food, portion: number) {
    onLogFood(food, meal.id, portion);
    const kcal = Math.round((food.calories * portion) / 100);
    toast.success(
      `Added ${food.name} (${portion} g, ${kcal} kcal) to ${meal.name}`,
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-left">{meal.name}</DialogTitle>
        <DialogDescription className="text-left font-mono text-xs tabular-nums">
          {totalKcal} kcal · {meal.foods.length} food
          {meal.foods.length === 1 ? "" : "s"}
        </DialogDescription>
      </DialogHeader>

      {recents.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quick add
          </h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {recents.map((r) => {
              const kcal = Math.round((r.food.calories * r.lastPortion) / 100);
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => quickAdd(r.food, r.lastPortion)}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40 active:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {r.name}
                    </span>
                    <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                      {kcal} kcal · {r.lastPortion} g
                    </span>
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Search + (empty meal) the same three actions as the card, so a user
          who lands here on an empty meal isn't dead-ended. AI generate runs
          inline (the hub updates live); template / recipe open their own
          pickers, so close the hub first to avoid stacked modals. */}
      <section className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={onOpenSearch}
        >
          <Search className="h-3.5 w-3.5" />
          Search foods
        </Button>
        {!hasFoods && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                onClose();
                onAddFromTemplate(meal.id);
              }}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Use template
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                onClose();
                onApplyRecipe(meal.id);
              }}
            >
              <Soup className="h-3.5 w-3.5" />
              Apply recipe
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={regenerating}
              onClick={() => onRegenerate(meal.id)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {regeneratingThisMeal ? "Generating…" : "AI generate"}
            </Button>
          </>
        )}
      </section>

      {hasFoods && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            In this meal
          </h3>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
            {meal.foods.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {f.name}
                  </span>
                  <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(f.calories)} kcal · {Math.round(f.portionSize)}{" "}
                    g
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveFood(meal.id, f.id)}
                  aria-label={`Remove ${f.name}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground active:bg-muted"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Insights + AI advice (Pro) — the existing read-only body, verbatim. */}
      {hasFoods && (
        <MealDetail
          meal={meal}
          goal={goal}
        />
      )}
    </>
  );
}
