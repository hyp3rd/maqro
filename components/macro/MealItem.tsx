"use client";

import type { CoherenceIssue } from "@/lib/ai/plan-coherence";
import React from "react";
import {
  AlertTriangle,
  BookmarkPlus,
  ChefHat,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Food,
  FoodItem as FoodItemType,
  Meal as MealType,
} from "../../components/macro/types";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import FoodItem from "./FoodItem";
import FoodMobileCard from "./FoodMobileCard";

interface MealItemProps {
  meal: MealType;
  editingFood: {
    mealId: number | null;
    foodId: number | null;
    portionSize: number;
    originalFood: FoodItemType | null;
  };
  replacingFood: {
    mealId: number | null;
    foodId: number | null;
    portionSize: number;
    searchTerm: string;
    suggestions: Food[];
    showSuggestions: boolean;
  };
  replacementSuggestionsRef: React.RefObject<HTMLDivElement | null>;
  startEditingFood: (mealId: number, food: FoodItemType) => void;
  cancelEditing: () => void;
  handleEditPortionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  saveEditedPortion: () => void;
  startReplacingFood: (mealId: number, food: FoodItemType) => void;
  cancelReplacing: () => void;
  handleReplacementSearch: (e: React.ChangeEvent<HTMLInputElement>) => void;
  replaceFood: (newFood: Food) => void;
  removeFood: (mealId: number, foodId: number) => void;
  duplicateFood: (mealId: number, foodId: number) => void;
  onSaveAsTemplate: (mealId: number) => void;
  onAddFromTemplate: (mealId: number) => void;
  onApplyRecipe: (mealId: number) => void;
  /** Open the meal-detail sheet (macro/micro breakdown + insights). */
  onOpenDetail: (mealId: number) => void;
  /** AI-regenerate ONLY this meal slot. The parent calls the
   *  meal-plan route with `targetMealName` set and replaces just this
   *  meal's foods on success. */
  onRegenerate: (mealId: number) => void;
  /** Shared busy state - disables the regenerate button while any AI
   *  request is in flight (full-day generate, refiner pill, or
   *  another single-meal regeneration). */
  regenerating: boolean;
  /** True iff THIS specific meal is the one being (re)generated.
   *  Drives the inline "Generating…" indicator in the meal header so
   *  the user sees feedback at the slot they clicked, not just a
   *  global banner. */
  regeneratingThisMeal: boolean;
  /** Coherence-validator issues anchored to this specific meal slot.
   *  Empty array (the common case) renders nothing; otherwise an amber
   *  chip with the message + a one-tap "Regenerate" action surfaces
   *  directly on the offending card so the user doesn't have to scan
   *  a global banner to find what's wrong. */
  issues: CoherenceIssue[];
}

const MealItem: React.FC<MealItemProps> = ({
  meal,
  editingFood,
  replacingFood,
  replacementSuggestionsRef,
  startEditingFood,
  cancelEditing,
  handleEditPortionChange,
  saveEditedPortion,
  startReplacingFood,
  cancelReplacing,
  handleReplacementSearch,
  replaceFood,
  removeFood,
  duplicateFood,
  onSaveAsTemplate,
  onAddFromTemplate,
  onApplyRecipe,
  onOpenDetail,
  onRegenerate,
  regenerating,
  regeneratingThisMeal,
  issues,
}) => {
  // Empty slot = "Generate" verb; populated slot = "Regenerate". A
  // brand-new user clicking on Lunch shouldn't see "Regenerate" -
  // there's nothing to regenerate yet. The progressive form drops
  // the trailing 'e' before -ing per English orthography (both verbs
  // happen to end in 'e' so no conditional needed).
  const aiVerb = meal.foods.length === 0 ? "Generate" : "Regenerate";
  const aiVerbProgressive = `${aiVerb.slice(0, -1)}ing`;
  const totalProtein = Math.round(
    meal.foods.reduce((s, f) => s + f.protein, 0),
  );
  const totalCarbs = Math.round(meal.foods.reduce((s, f) => s + f.carbs, 0));
  const totalFat = Math.round(meal.foods.reduce((s, f) => s + f.fat, 0));
  const totalCalories = Math.round(
    meal.foods.reduce((s, f) => s + f.calories, 0),
  );

  // Stable per-row ids matching FoodItem's `${mealId}:${food.id}`. dnd-kit
  // needs to see each meal as its own sortable container so cross-meal
  // drops work via the meal-level `data.mealId`.
  const sortableIds = meal.foods.map((f) => `${meal.id}:${f.id}`);
  // Droppable so an empty meal (no sortable items) can still receive a
  // drop. The id is the meal block; the data tells onDragEnd where it
  // landed.
  const { setNodeRef, isOver } = useDroppable({
    id: `meal-${meal.id}`,
    data: { mealId: meal.id, type: "meal" },
  });

  return (
    <div
      ref={setNodeRef}
      className={`px-3 py-3 transition-colors sm:px-5 sm:py-4 ${
        isOver ? "bg-accent/40" : ""
      }`}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h4 className="text-sm font-semibold tracking-tight text-foreground">
          {meal.name}
        </h4>
        <div className="flex items-center gap-1.5">
          {meal.foods.length > 0 && !regeneratingThisMeal && (
            <button
              type="button"
              onClick={() => onOpenDetail(meal.id)}
              aria-label={`${meal.name} insights`}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
            >
              <Sparkles className="h-3 w-3" />
              Insights
            </button>
          )}
          {regeneratingThisMeal ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground sm:text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              {aiVerbProgressive}…
            </span>
          ) : (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground sm:text-xs">
              {totalCalories} kcal · P{totalProtein} · C{totalCarbs} · F
              {totalFat}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground sm:h-8 sm:w-8"
                aria-label={`${meal.name} actions`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44"
            >
              <DropdownMenuItem
                onClick={() => onRegenerate(meal.id)}
                disabled={regenerating}
                className="gap-2"
              >
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                {aiVerb} (AI)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddFromTemplate(meal.id)}
                className="gap-2"
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                Add from template
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onApplyRecipe(meal.id)}
                className="gap-2"
              >
                <ChefHat className="h-3.5 w-3.5 text-muted-foreground" />
                Apply recipe
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSaveAsTemplate(meal.id)}
                disabled={meal.foods.length === 0}
                className="gap-2"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-muted-foreground" />
                Save as template
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mb-3 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          {issues.map((issue, idx) => (
            <div
              key={`${issue.code}-${idx}`}
              className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-100 sm:text-xs"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="flex-1">{issue.message}</p>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onRegenerate(meal.id)}
            disabled={regenerating}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-600/40 bg-background px-2.5 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-900/30"
          >
            {regeneratingThisMeal ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {aiVerbProgressive}…
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                Regenerate this meal
              </>
            )}
          </button>
        </div>
      )}

      {meal.foods.length === 0 ? (
        <div
          className={`rounded-md border border-dashed px-4 py-4 text-center ${
            isOver ? "border-foreground/40" : "border-border/60"
          }`}
        >
          <p className="text-xs text-muted-foreground">
            {isOver ? "Drop here" : "No foods added yet"}
          </p>
          {/* Quick-start chips. Surfaced instead of just "No foods
              added yet" because the dropdown menu above is two taps
              away on mobile; these are one-tap. The chip set mirrors
              the three actions in the meal-row menu, so users learn
              the same vocabulary by seeing it twice. */}
          {!isOver && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {/* Quick add steps into the per-meal hub (recents + search +
                  insights/advice) — same surface the Insights badge opens. */}
              <button
                type="button"
                onClick={() => onOpenDetail(meal.id)}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-foreground/30 bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                <Plus className="h-3 w-3" />
                Quick add
              </button>
              <button
                type="button"
                onClick={() => onAddFromTemplate(meal.id)}
                className="inline-flex h-7 items-center rounded-full border border-border/60 bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                Use template
              </button>
              <button
                type="button"
                onClick={() => onApplyRecipe(meal.id)}
                className="inline-flex h-7 items-center rounded-full border border-border/60 bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                Apply recipe
              </button>
              <button
                type="button"
                onClick={() => onRegenerate(meal.id)}
                disabled={regenerating}
                className="inline-flex h-7 items-center rounded-full border border-border/60 bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {regeneratingThisMeal
                  ? `${aiVerbProgressive}…`
                  : `AI ${aiVerb.toLowerCase()}`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <SortableContext
          items={sortableIds}
          strategy={verticalListSortingStrategy}
        >
          {/* Mobile: card list. The 7-column dense table below is
              illegible at < 640px even with horizontal scroll; the
              card layout puts the food name + macros front-and-centre
              with full-size touch targets for replace / edit / delete. */}
          <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-background sm:hidden">
            {meal.foods.map((food) => (
              <FoodMobileCard
                key={food.id}
                food={food}
                mealId={meal.id}
                editingFood={editingFood}
                replacingFood={replacingFood}
                replacementSuggestionsRef={replacementSuggestionsRef}
                startEditingFood={startEditingFood}
                cancelEditing={cancelEditing}
                handleEditPortionChange={handleEditPortionChange}
                saveEditedPortion={saveEditedPortion}
                startReplacingFood={startReplacingFood}
                cancelReplacing={cancelReplacing}
                handleReplacementSearch={handleReplacementSearch}
                replaceFood={replaceFood}
                removeFood={removeFood}
                duplicateFood={duplicateFood}
              />
            ))}
          </ul>

          {/* Desktop: keep the dense table for at-a-glance comparison. */}
          <div className="hidden overflow-x-auto rounded-md border border-border/60 sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <th
                    className="w-8 px-1 py-2"
                    aria-hidden
                  />
                  <th className="px-3 py-2 text-left">Food</th>
                  <th className="px-3 py-2 text-center">Portion</th>
                  <th className="px-3 py-2 text-center">P</th>
                  <th className="px-3 py-2 text-center">C</th>
                  <th className="px-3 py-2 text-center">F</th>
                  <th className="px-3 py-2 text-center">kcal</th>
                  <th className="px-3 py-2 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {meal.foods.map((food) => (
                  <FoodItem
                    key={food.id}
                    food={food}
                    mealId={meal.id}
                    editingFood={editingFood}
                    replacingFood={replacingFood}
                    replacementSuggestionsRef={replacementSuggestionsRef}
                    startEditingFood={startEditingFood}
                    cancelEditing={cancelEditing}
                    handleEditPortionChange={handleEditPortionChange}
                    saveEditedPortion={saveEditedPortion}
                    startReplacingFood={startReplacingFood}
                    cancelReplacing={cancelReplacing}
                    handleReplacementSearch={handleReplacementSearch}
                    replaceFood={replaceFood}
                    removeFood={removeFood}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </SortableContext>
      )}
    </div>
  );
};

export default MealItem;
