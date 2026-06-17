"use client";

import type { CoherenceIssue } from "@/lib/ai/plan-coherence";
import type { MealSchedule } from "@/lib/db";
import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookmarkPlus,
  CalendarCheck,
  ChefHat,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import FoodItem from "./FoodItem";
import FoodMobileCard from "./FoodMobileCard";
import type { MealHubIntent } from "./MealHubSheet";

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
  /** Clear every food from this meal in one go (with an Undo toast). */
  onClearMeal: (mealId: number) => void;
  /** Most-recent "food logged" pulse from the parent. A fresh object per
   *  add (its identity, not value, retriggers the flash) — this card pulses
   *  + scrolls into view only when `loggedSignal.mealId` matches its own. */
  loggedSignal: { mealId: number } | null;
  /** A schedule due for this slot today (if any) — drives the one-tap
   *  "log it" offer shown on the empty slot. */
  scheduledForSlot?: MealSchedule;
  /** Log the scheduled recipe into this slot. */
  onLogScheduled: (schedule: MealSchedule, mealId: number) => void;
  /** Open the per-meal hub. `intent` picks what it leads with: "add" (the
   *  "Log this again" strip — the default for the add affordances) vs
   *  "insights" (the breakdown body — the Insights badge). */
  onOpenDetail: (mealId: number, intent?: MealHubIntent) => void;
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
  onClearMeal,
  loggedSignal,
  scheduledForSlot,
  onLogScheduled,
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

  // "Food landed here" pulse. The parent hands every card the same
  // loggedSignal object; a fresh identity each add lets each card tell
  // whether the latest log targeted IT. We detect that during render (the
  // sanctioned way to react to a changed prop — an effect here would trip
  // the set-state-in-effect rule), tracking the last identity we acted on.
  const reducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [flash, setFlash] = useState(false);
  const [seenSignal, setSeenSignal] = useState(loggedSignal);
  if (loggedSignal !== seenSignal) {
    setSeenSignal(loggedSignal);
    if (loggedSignal && loggedSignal.mealId === meal.id) setFlash(true);
  }
  // Once the pulse is on, scroll the card into view and auto-clear it. The
  // tint fades out via the wrapper's color transition; reduced-motion users
  // still get the scroll, just without the smooth animation. setFlash lives
  // in the timeout callback (not the effect body), so it's clear of the rule.
  useEffect(() => {
    if (!flash) return;
    cardRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reducedMotion ? "auto" : "smooth",
    });
    const timer = window.setTimeout(() => setFlash(false), 1100);
    return () => window.clearTimeout(timer);
  }, [flash, reducedMotion]);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        cardRef.current = node;
      }}
      className={`px-3 py-3 transition-colors duration-500 sm:px-5 sm:py-4 ${
        flash ? "bg-primary/10" : isOver ? "bg-accent/40" : ""
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
              onClick={() => onOpenDetail(meal.id, "insights")}
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
                // 44px hit area on touch (coarse) per WCAG 2.5.5; mouse
                // pointers keep the compact 36px. No `sm:` shrink so a
                // coarse tablet at ≥640px isn't dropped to a 32px target.
                className="h-9 w-9 text-muted-foreground coarse:h-11 coarse:w-11"
                aria-label={`${meal.name} actions`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44"
            >
              {/* Fast path for an already-populated meal: jump straight into
                  the per-meal hub (recents + search, pre-targeted to this
                  slot) instead of the full Log-meal flow. The empty slot
                  already has its own "Quick add" chip, so this only earns its
                  place once there's food to add to. */}
              {meal.foods.length > 0 && (
                <>
                  <DropdownMenuItem
                    onClick={() => onOpenDetail(meal.id)}
                    className="gap-2"
                  >
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    Add food
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onClearMeal(meal.id)}
                disabled={meal.foods.length === 0}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear meal
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
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-600/40 bg-background px-2.5 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 coarse:h-10 dark:text-amber-100 dark:hover:bg-amber-900/30"
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
          {scheduledForSlot && !isOver && (
            <button
              type="button"
              onClick={() => onLogScheduled(scheduledForSlot, meal.id)}
              className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-foreground/40 bg-foreground px-3 py-2 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90"
            >
              <CalendarCheck className="h-3.5 w-3.5" />
              Scheduled: {scheduledForSlot.recipeName} — Log it
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {isOver ? "Drop here" : "No foods added yet"}
          </p>
          {/* One add affordance. Tapping it opens the per-meal hub, which leads
              with "Log this again" (slot recents, one tap) and carries the
              search + template / recipe / AI-generate actions — so the empty
              slot no longer duplicates that whole menu inline (it used to mirror
              the row's ⋮ menu, which is one tap away anyway). */}
          {!isOver && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => onOpenDetail(meal.id, "add")}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground/30 bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-accent/40 coarse:h-11"
              >
                <Plus className="h-4 w-4" />
                Add food
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
