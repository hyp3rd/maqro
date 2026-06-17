"use client";

import { usePastMealsForSlot } from "@/hooks/use-past-meals";
import { useState } from "react";
import { LayoutGrid, Plus, Soup, Sparkles, Trash2 } from "lucide-react";
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

/** How the hub was opened — drives whether a populated meal leads with the
 *  "Log this again" strip (the user came to ADD) or with the insights body (the
 *  user tapped the Insights badge to READ). Empty meals always lead with the
 *  strip; there's nothing to read yet. */
export type MealHubIntent = "add" | "insights";

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
  /** One-tap re-add from the "Log this again" strip: logs AND confirms with a
   *  toast (the strip is the only in-hub add that isn't the search sheet, which
   *  toasts itself). */
  onQuickLog: (food: Food, mealId: number, grams: number) => void;
  /** Whether this open should lead with the recents strip (add) or the insights
   *  body (insights). Only affects a populated meal. */
  intent: MealHubIntent;
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
  onQuickLog,
  intent,
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
              intent={intent}
              onQuickLog={onQuickLog}
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
  intent,
  onQuickLog,
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
  intent: MealHubIntent;
  onQuickLog: (food: Food, mealId: number, grams: number) => void;
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

  // A single prominent action that opens the dedicated food-search sheet
  // (recents + search + inline portion editor all live there), so the hub stays
  // focused on the meal's contents + insights rather than an inline add UI.
  const addFoodButton = (
    <Button
      type="button"
      className="h-11 w-full gap-1.5"
      onClick={onOpenSearch}
    >
      <Plus className="h-4 w-4" />
      Add food
    </Button>
  );

  // The dominant path: re-log a staple into THIS slot in one tap. Scoped to the
  // slot's own history (topped up from global recents when sparse), renders
  // nothing when the user has no recents at all. Logs + toasts + keeps the hub
  // open for repeat adds.
  const logAgainStrip = (
    <QuickAddFoods
      slotName={meal.name}
      onAdd={(food, portion) => onQuickLog(food, meal.id, portion)}
    />
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-left">{meal.name}</DialogTitle>
        <DialogDescription className="text-left font-mono text-xs tabular-nums">
          {totalKcal} kcal · {meal.foods.length} food
          {meal.foods.length === 1 ? "" : "s"}
        </DialogDescription>
      </DialogHeader>

      {/* Empty meal: nothing to read yet. Lead with "Log this again" (the
          fastest re-log path), then the add action + the empty-state shortcuts
          (template / recipe / AI / copy). AI generate runs inline (the hub
          updates live); template / recipe open their own pickers, so close the
          hub first to avoid stacked modals. */}
      {!hasFoods && (
        <>
          {logAgainStrip}

          {addFoodButton}

          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col gap-1.5 px-1 py-3 text-xs font-medium"
              onClick={() => {
                onClose();
                onAddFromTemplate(meal.id);
              }}
            >
              <LayoutGrid className="h-4 w-4" />
              Use template
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col gap-1.5 px-1 py-3 text-xs font-medium"
              onClick={() => {
                onClose();
                onApplyRecipe(meal.id);
              }}
            >
              <Soup className="h-4 w-4" />
              Apply recipe
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={regenerating}
              className="h-auto flex-col gap-1.5 px-1 py-3 text-xs font-medium"
              onClick={() => onRegenerate(meal.id)}
            >
              <Sparkles className="h-4 w-4" />
              {regeneratingThisMeal ? "Generating…" : "AI generate"}
            </Button>
          </div>

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
                        {pm.foods.length === 1 ? "" : "s"} · {pm.totalKcal} kcal
                        · {pm.foods.map((f) => f.name).join(", ")}
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
        </>
      )}

      {/* Populated meal. Ordering follows the entry intent: opened to ADD →
          lead with "Log this again" (thumb zone), then contents + insights;
          opened via the Insights badge to READ → lead with contents + insights
          and trail the strip. Either way the Add-food action closes the body. */}
      {hasFoods && (
        <>
          {intent === "add" && logAgainStrip}

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
                      {Math.round(f.calories)} kcal ·{" "}
                      {Math.round(f.portionSize)} g
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

          {/* Insights + AI advice (Pro) — the existing read-only body. */}
          <MealDetail
            meal={meal}
            goal={goal}
          />

          {intent === "insights" && logAgainStrip}

          {addFoodButton}
        </>
      )}
    </>
  );
}
