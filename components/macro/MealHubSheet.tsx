"use client";

import { usePastMealsForSlot } from "@/hooks/use-past-meals";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  ChevronDown,
  LayoutGrid,
  Plus,
  Soup,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
import { QuickAddFoods } from "./QuickAddFoods";
import type { Food, FoodItem, Meal } from "./types";

/** "Mon, Jun 1" from a YYYY-MM-DD key (parsed as a local calendar date). */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

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
  /** Append a previous day's meal-slot foods into this meal. */
  onCopyMeal: (mealId: number, items: FoodItem[]) => void;
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
  onCopyMeal,
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
        <DialogContent
          className="max-h-[88vh] gap-3 overflow-y-auto"
          // The full-screen search sheet stacks on top as a sibling portal, not
          // a Radix child — so taps inside it register as "outside" this dialog
          // and (even non-modal) would dismiss it, unmounting the search along
          // with it (the `meal && <FoodSearchSheet>` below). While search is
          // open, hold the hub open; the search owns dismissal via its Back
          // button + its own Escape handler.
          onInteractOutside={(e) => {
            if (searchOpen) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (searchOpen) e.preventDefault();
          }}
        >
          {meal && (
            <MealHubBody
              key={meal.id}
              meal={meal}
              goal={goal}
              onLogFood={onLogFood}
              onRemoveFood={onRemoveFood}
              onCopyMeal={onCopyMeal}
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
  onCopyMeal,
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
  onCopyMeal: (mealId: number, items: FoodItem[]) => void;
  onAddFromTemplate: (mealId: number) => void;
  onApplyRecipe: (mealId: number) => void;
  onRegenerate: (mealId: number) => void;
  regenerating: boolean;
  regeneratingThisMeal: boolean;
  onOpenSearch: () => void;
  onClose: () => void;
}) {
  const pastMeals = usePastMealsForSlot(meal.name);
  const hasFoods = meal.foods.length > 0;
  const totalKcal = Math.round(meal.foods.reduce((s, f) => s + f.calories, 0));
  // The whole add-food set (quick-add, search, copy, the empty-meal actions)
  // sits behind one collapsible button. It opens expanded by default — adding
  // is the most common reason to open the hub, on a populated meal too — and
  // can be collapsed to read the meal's contents + insights without scrolling.
  const [addOpen, setAddOpen] = useState(true);

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

      <div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-between gap-1.5"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((o) => !o)}
        >
          <span className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Add food
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              addOpen && "rotate-180",
            )}
          />
        </Button>

        <AnimatePresence initial={false}>
          {addOpen && (
            <motion.div
              key="add"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 pt-3">
                <QuickAddFoods
                  onAdd={quickAdd}
                  onSearch={onOpenSearch}
                />

                {/* Empty meal only: the same three actions as the card, so a
                    user who lands here on an empty meal isn't dead-ended
                    (search lives in the quick-add card above). AI generate runs
                    inline (the hub updates live); template / recipe open their
                    own pickers, so close the hub first to avoid stacked
                    modals. */}
                {!hasFoods && (
                  <section className="flex flex-wrap items-center gap-1.5">
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
                  </section>
                )}

                {pastMeals.length > 0 && (
                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Copy a previous {meal.name}
                    </h3>
                    <ul className="space-y-1.5">
                      {pastMeals.slice(0, 5).map((pm) => (
                        <li
                          key={pm.date}
                          className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">
                              {dayLabel(pm.date)}
                            </span>
                            <span className="block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                              {pm.foods.length} food
                              {pm.foods.length === 1 ? "" : "s"} ·{" "}
                              {pm.totalKcal} kcal ·{" "}
                              {pm.foods.map((f) => f.name).join(", ")}
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={() => onCopyMeal(meal.id, pm.foods)}
                          >
                            Copy
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
