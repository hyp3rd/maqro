"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addDays,
  enumerateDateRange,
  filterByDayOfWeek,
  scaffoldBatchDay,
} from "@/lib/batch-apply";
import {
  getDailyLog,
  listPantryItems,
  type PantryItem,
  saveDailyLog,
  todayKey,
} from "@/lib/db";
import { applyPantryDelta } from "@/lib/pantry/apply-delta";
import {
  planPerFoodConsumptionAgainstBalance,
  roundQuantity,
} from "@/lib/pantry/consume";
import { scaleRecipeIngredients } from "@/lib/scale-recipe";
import { bumpPending } from "@/lib/sync-status";
import { notifyDataChanged } from "@/lib/sync/data-bus";
import { useState } from "react";
import { toast } from "sonner";
import { ServingsStepper } from "./ServingsStepper";
import type { FoodItem, Meal, Recipe, RecipeIngredient } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The recipe to fan out across multiple (date, meal-slot) cells. */
  recipe: Recipe;
  /** The user's current-day meal slot structure. Used both as the
   *  set of meal-name checkboxes the user can pick from AND as the
   *  default slot layout for days that don't have a daily_log row
   *  yet — so a batch-apply to a future day creates the same
   *  Breakfast/Lunch/Dinner/Snacks scaffold the user is already
   *  using today. */
  currentMeals: readonly Meal[];
};

/** Default DOW set: Mon–Fri only. Catches the most common
 *  meal-prep use case ("Sunday cook for the work week") without
 *  needing the user to uncheck weekend boxes. They can flip them on
 *  with one click. */
const WEEKDAY_SET: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DOW_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function BatchApplyRecipeDialog({
  open,
  onOpenChange,
  recipe,
  currentMeals,
}: Props) {
  const today = todayKey();
  // Default range: today through six days out = a one-week meal
  // plan. Most "Sunday cook for the week" users want exactly this.
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 6));
  const [allowedDows, setAllowedDows] = useState<ReadonlySet<number>>(
    () => new Set(WEEKDAY_SET),
  );
  // Default to applying to the current day's first lunch-shaped slot
  // (index 1 of the typical Breakfast/Lunch/Dinner/Snacks template).
  // Falls back to the first slot if there are fewer than two — better
  // than zero defaults that force the user to pick before the Apply
  // button works.
  const [selectedMealIds, setSelectedMealIds] = useState<ReadonlySet<number>>(
    () => {
      const initial = currentMeals[1] ?? currentMeals[0];
      return new Set(initial ? [initial.id] : []);
    },
  );
  const [busy, setBusy] = useState(false);
  // Servings multiplier applied to the recipe before fanning out.
  // 2× scales every ingredient's portionGrams to 2×; 0.5× halves.
  // Per-day, not per-slot — the meal-prep use case is "cook 5
  // servings for the week," not "1× for Monday, 2× for Friday."
  const [scale, setScale] = useState(1);

  const allDatesInRange = enumerateDateRange(startDate, endDate);
  const selectedDates = filterByDayOfWeek(allDatesInRange, allowedDows);
  const targetCellCount = selectedDates.length * selectedMealIds.size;
  const canApply =
    !busy &&
    selectedDates.length > 0 &&
    selectedMealIds.size > 0 &&
    startDate <= endDate;

  function toggleDow(dow: number) {
    setAllowedDows((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  }

  function toggleMealId(id: number) {
    setSelectedMealIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    try {
      // Translate selected ids to NAMES at apply time. The loop
      // below matches each day's meals by name (case-insensitive)
      // rather than by id because meal-template edits can give a
      // user different ids on old days versus today — but the names
      // are the user-facing handle and are what the dialog showed.
      const targetMealNames = new Set(
        currentMeals
          .filter((m) => selectedMealIds.has(m.id))
          .map((m) => m.name.trim().toLowerCase()),
      );
      // Scale the recipe's ingredients before fanning out. Cheap
      // when scale === 1 (returns a clone unchanged); otherwise
      // multiplies every portionGrams. macrosPer100g is left
      // untouched — it's a per-100g constant, so the per-meal
      // macros computed at apply time scale automatically.
      const scaledIngredients = scaleRecipeIngredients(
        recipe.ingredients,
        scale,
      );
      const { cells: cellsWritten, pantryItemsUsed } = await batchApplyRecipe({
        recipe,
        scaledIngredients,
        dates: selectedDates,
        targetMealNames,
        fallbackMealStructure: currentMeals,
      });
      bumpPending();
      // Bump the data-bus rev so the currently-loaded day refreshes
      // if it was one of the targets. Other days will load fresh
      // from IDB next time the user navigates to them.
      notifyDataChanged("dailyLogs");
      toast.success(
        `Applied ${recipe.name} to ${cellsWritten} slot${cellsWritten === 1 ? "" : "s"}.`,
      );
      if (pantryItemsUsed > 0) {
        toast.success(
          `Used ${pantryItemsUsed} pantry item${pantryItemsUsed === 1 ? "" : "s"}.`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't apply the recipe.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-tight">
            Cook once, log for…
          </DialogTitle>
          <DialogDescription>
            Apply <strong>{recipe.name}</strong> to several days and meal slots
            in one go. Ingredients are appended — existing foods stay put.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="batch-from"
                className="text-xs font-medium text-muted-foreground"
              >
                From
              </Label>
              <Input
                id="batch-from"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="batch-to"
                className="text-xs font-medium text-muted-foreground"
              >
                To
              </Label>
              <Input
                id="batch-to"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Days of the week
            </p>
            <div className="flex gap-1">
              {DOW_LABELS.map((label, dow) => {
                const active = allowedDows.has(dow);
                return (
                  <button
                    key={dow}
                    type="button"
                    onClick={() => toggleDow(dow)}
                    aria-pressed={active}
                    aria-label={DOW_FULL[dow]}
                    className={`h-9 flex-1 rounded-md border text-xs font-medium transition-colors ${
                      active
                        ? "border-foreground/40 bg-foreground text-background"
                        : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Meal slots
            </p>
            <div className="flex flex-wrap gap-1.5">
              {currentMeals.map((m) => {
                const active = selectedMealIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMealId(m.id)}
                    aria-pressed={active}
                    className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-medium transition-colors ${
                      active
                        ? "border-foreground/40 bg-foreground text-background"
                        : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40"
                    }`}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <ServingsStepper
              value={scale}
              onChange={setScale}
            />
            {scale !== 1 && (
              <span className="text-[11px] text-muted-foreground">
                Each portion × {scale.toFixed(2).replace(/\.?0+$/, "")}
              </span>
            )}
          </div>

          <PreviewLine
            dates={selectedDates}
            mealCount={selectedMealIds.size}
            mealNames={currentMeals
              .filter((m) => selectedMealIds.has(m.id))
              .map((m) => m.name)}
            invalidRange={startDate > endDate}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void apply()}
            disabled={!canApply}
          >
            {busy
              ? "Applying…"
              : targetCellCount === 0
                ? "Apply"
                : `Apply to ${targetCellCount} slot${targetCellCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewLine({
  dates,
  mealCount,
  mealNames,
  invalidRange,
}: {
  dates: readonly string[];
  mealCount: number;
  mealNames: readonly string[];
  invalidRange: boolean;
}) {
  if (invalidRange) {
    return (
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
        End date is before the start date.
      </p>
    );
  }
  if (dates.length === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        No days match the current selection — pick a wider range or enable more
        weekdays.
      </p>
    );
  }
  if (mealCount === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        Pick at least one meal slot.
      </p>
    );
  }
  const slotLabel =
    mealNames.length <= 2
      ? mealNames.join(" and ")
      : `${mealNames.length} meal slots`;
  const first = dates[0];
  const last = dates[dates.length - 1];
  return (
    <p className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
      Will apply to <strong>{slotLabel}</strong> on{" "}
      <strong>
        {dates.length} day{dates.length === 1 ? "" : "s"}
      </strong>{" "}
      ({prettyDate(first ?? "")} → {prettyDate(last ?? "")}).
    </p>
  );
}

function prettyDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/* ─────────────────────────────────────────────────────────────────
 *  Batch apply — IDB write loop
 * ──────────────────────────────────────────────────────────────── */

type BatchApplyInput = {
  recipe: Recipe;
  /** Ingredients to actually fan out — the caller pre-scales these
   *  with `scaleRecipeIngredients` so the loop here doesn't need to
   *  know about servings multipliers. Keeping the scaling out of
   *  this function keeps the IDB write loop single-purpose. */
  scaledIngredients: readonly RecipeIngredient[];
  dates: readonly string[];
  /** Lower-cased trimmed meal names to target. Name-based matching
   *  (rather than id-based) is the right granularity because meal
   *  templates evolve over time — a user who renamed "Snacks" to
   *  "Evening" today still wants their batch-apply to land on the
   *  "Evening" slot of every day in the range, regardless of what
   *  the saved daily-log rows happen to call their slot id 4. */
  targetMealNames: ReadonlySet<string>;
  /** Used as the meal-slot scaffold for days that don't have a
   *  daily_log row yet. Names + ids carry over so a new day gets
   *  the same Breakfast/Lunch/Dinner/Snacks layout the user is
   *  already using today. */
  fallbackMealStructure: readonly Meal[];
};

/** For each `(date × matching meal)` cell, append the recipe's
 *  ingredients (already-portioned, with original-per-100g metadata
 *  so re-edits in the slot UI still work) to the meal's foods
 *  array. Returns the total number of cells written so the caller
 *  can toast. */
async function batchApplyRecipe({
  recipe,
  scaledIngredients,
  dates,
  targetMealNames,
  fallbackMealStructure,
}: BatchApplyInput): Promise<{ cells: number; pantryItemsUsed: number }> {
  void recipe;
  // Unique-id base — Date.now() + an incrementing counter so the
  // FoodItem ids across an entire batch don't collide and React keys
  // stay stable. Days are processed sequentially; the counter only
  // needs to be unique within a single batch.
  let nextFoodId = Date.now();

  function cloneIngredients(): FoodItem[] {
    return scaledIngredients.map((ing) => {
      const r = ing.portionGrams / 100;
      return {
        id: nextFoodId++,
        name: ing.foodName,
        protein: Number.parseFloat((ing.macrosPer100g.protein * r).toFixed(1)),
        carbs: Number.parseFloat((ing.macrosPer100g.carbs * r).toFixed(1)),
        fat: Number.parseFloat((ing.macrosPer100g.fat * r).toFixed(1)),
        calories: Math.round(ing.macrosPer100g.calories * r),
        portionSize: ing.portionGrams,
        originalValues: {
          proteinPer100g: ing.macrosPer100g.protein,
          carbsPer100g: ing.macrosPer100g.carbs,
          fatPer100g: ing.macrosPer100g.fat,
          caloriesPer100g: ing.macrosPer100g.calories,
        },
      };
    });
  }

  // Read the pantry once and thread a running balance through every
  // matched (date × slot) cell. Skipped slots (name mismatch) never
  // touch the balance, so a batch onto a week with only 3 matching
  // slots doesn't draw 7 days' worth of ingredients — same fix the
  // 0.1.96 day-view batch shipped, applied to the recipe-view batch.
  let pantryItems: PantryItem[] = [];
  try {
    pantryItems = await listPantryItems();
  } catch {
    // Pantry unavailable — the daily logs still write; foods just
    // won't carry pantrySource stamps. Drift is preferable to
    // blocking the batch apply outright.
  }
  const balance = new Map(pantryItems.map((i) => [i.id, i.quantity] as const));
  const drawByItem = new Map<string, number>();

  let cells = 0;
  for (const date of dates) {
    const existing = await getDailyLog(date);
    // Existing day → keep its meals; new day → the fallback slot layout with
    // EMPTY foods (NOT a copy of today's foods — see `scaffoldBatchDay`).
    const base = scaffoldBatchDay(
      existing?.meals ?? null,
      fallbackMealStructure,
    );

    const updated = base.map((m) => {
      if (!targetMealNames.has(m.name.trim().toLowerCase())) return m;
      const added = cloneIngredients();
      const draws = planPerFoodConsumptionAgainstBalance(
        added.map((f) => ({ name: f.name, grams: f.portionSize })),
        pantryItems,
        balance,
      );
      added.forEach((f, i) => {
        const d = draws[i];
        if (d) {
          f.pantrySource = d;
          drawByItem.set(
            d.itemId,
            roundQuantity((drawByItem.get(d.itemId) ?? 0) + d.consumedQty),
          );
        }
      });
      cells++;
      return { ...m, foods: [...m.foods, ...added] };
    });

    await saveDailyLog(date, updated);
  }

  // Fan out aggregated draws through the shared serialized chain so
  // they interleave correctly with any concurrent meal-planner writes
  // and fire low-stock notifications on threshold crosses.
  for (const [itemId, qty] of drawByItem) applyPantryDelta(itemId, qty);
  return { cells, pantryItemsUsed: drawByItem.size };
}
