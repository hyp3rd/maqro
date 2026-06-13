"use client";

import type { CoherenceIssue } from "@/lib/ai/plan-coherence";
import { REFINERS } from "@/lib/ai/refiners";
import type { MealSchedule, PantryItem } from "@/lib/db";
import { schedulesForDay, scheduleTargetsSlot } from "@/lib/meal-schedule";
import React from "react";
import {
  AlertTriangle,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  CalculatedValues,
  Food,
  FoodItem,
  type GoalPhase,
  MacroBreakdown,
  Meal,
} from "../../components/macro/types";
import { DateNavigator } from "../shell/DateNavigator";
import type { ViewKey } from "../shell/Sidebar";
import { Button } from "../ui/button";
import { ActivePhaseBanner } from "./ActivePhaseBanner";
import AddFoodForm from "./AddFoodForm";
import DailyTotals from "./DailyTotals";
import { FastingCard } from "./FastingCard";
import MealItem from "./MealItem";
import {
  PreDiabeticDisclaimerDialog,
  hasDismissedPreDiabeticDisclaimer,
} from "./PreDiabeticDisclaimerDialog";
import { QuickAddFab } from "./QuickAddFab";
import { WaterCounter } from "./WaterCounter";

interface MealPlannerProps {
  calculatedValues: CalculatedValues;
  totalMacros: {
    protein: number;
    carbs: number;
    fat: number;
    calories: number;
  };
  /** Optional sub-macro totals (sugars / fiber / fat subtypes). Only
   *  keys actually contributed by today's foods are populated; the
   *  display layer hides rows for unknown values. */
  macroBreakdown: MacroBreakdown;
  meals: Meal[];
  selectedDate: string;
  today: string;
  /** Effective daily water goal (ml) for the water counter. */
  waterGoalMl: number;
  /** Display units for the water counter (ml ↔ fl oz). */
  units: "metric" | "imperial";
  /** The goal phase driving today's target (Pro), or `null`. Shows the
   *  active-phase banner above the daily totals. */
  goalPhase: GoalPhase | null;
  /** Diet-break suggestion text for the active phase, or `null`. */
  goalPhaseNudge: string | null;
  /** Switch the active app view — lets the fasting card link to the Fasting page. */
  onSelectView?: (key: ViewKey) => void;
  onSelectDate: (date: string) => void;
  newFood: FoodItem;
  foodSearch: string;
  foodSuggestions: Food[];
  /** Live pantry inventory, used to badge search results the user
   *  already has on hand. */
  pantryItems: PantryItem[];
  showSuggestions: boolean;
  isSearchingRemote: boolean;
  portionSize: number;
  isGeneratingMealPlan: boolean;
  /** Which meal slot is being (re)generated, if any. `null` = no
   *  per-meal AI call in flight. Full-day Auto-fill and refiner pills
   *  set `isGeneratingMealPlan` but leave this null, so the per-meal
   *  indicators don't all light up at once during a full-day rebuild. */
  generatingMealId: number | null;
  mealPlanMessage: string;
  /** Validator complaints from the most recent AI call. Per-meal
   *  issues (those with `mealName` set) anchor a warning chip on the
   *  offending MealItem. Day-level issues (`mealName` absent) render
   *  as a banner above the meal list with a refine action. */
  coherenceIssues: CoherenceIssue[];
  editingFood: {
    mealId: number | null;
    foodId: number | null;
    portionSize: number;
    originalFood: FoodItem | null;
  };
  replacingFood: {
    mealId: number | null;
    foodId: number | null;
    portionSize: number;
    searchTerm: string;
    suggestions: Food[];
    showSuggestions: boolean;
  };
  suggestionsRef: React.RefObject<HTMLDivElement | null>;
  replacementSuggestionsRef: React.RefObject<HTMLDivElement | null>;
  setNewFood: (food: FoodItem) => void;
  setFoodSearch: (value: string) => void;
  handleFoodSearch: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFoodSelect: (food: Food) => void;
  handlePortionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFoodChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  addFood: () => void;
  removeFood: (mealId: number, foodId: number) => void;
  duplicateFood: (mealId: number, foodId: number) => void;
  moveFood: (
    srcMealId: number,
    destMealId: number,
    foodId: number,
    destIndex?: number,
  ) => void;
  startEditingFood: (mealId: number, food: FoodItem) => void;
  cancelEditing: () => void;
  handleEditPortionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  saveEditedPortion: () => void;
  startReplacingFood: (mealId: number, food: FoodItem) => void;
  cancelReplacing: () => void;
  handleReplacementSearch: (e: React.ChangeEvent<HTMLInputElement>) => void;
  replaceFood: (newFood: Food) => void;
  generateMealPlan: () => Promise<void>;
  /** Apply a one-shot refinement to the current meal plan (sourced
   *  from a refiner pill like "lower sugars"). The parent calls
   *  /api/meal-plan with `refinement` + `previousMeals` and replaces
   *  `meals` on success. Reuses the same `isGeneratingMealPlan` busy
   *  state - only one AI request runs at a time. */
  onRefineMealPlan: (refinement: string) => Promise<void>;
  /** Regenerate ONLY one meal slot - fires the AI route with
   *  `targetMealName` set. The parent finds the returned meal by name
   *  and swaps it into the matching slot, leaving the others alone.
   *  Shares the `isGeneratingMealPlan` busy state. */
  onRegenerateMeal: (mealId: number) => Promise<void>;
  setPortionSize: (size: number) => void;
  onSaveOffToCustom: (food: Food) => void;
  onOpenCustomFoodForm: () => void;
  onOpenCamera: () => void;
  /** When provided, surfaces the voice-log mic button in
   *  AddFoodForm. Parent owns the VoiceLogSheet lifecycle +
   *  routes its `ResolvedMealPhoto` to the shared review
   *  dialog. Omit on surfaces where voice doesn't fit. */
  onOpenVoice?: () => void;
  onSaveAsTemplate: (mealId: number) => void;
  onAddFromTemplate: (mealId: number) => void;
  onApplyRecipe: (mealId: number) => void;
  onClearMeal: (mealId: number) => void;
  /** Pulse signal for the slot a food was just logged to. A fresh object
   *  per add (identity drives the effect) so the matching MealItem flashes
   *  and scrolls into view; null before the first add. */
  loggedMealSignal: { mealId: number } | null;
  /** Active meal schedules — surfaced as a one-tap "log it" offer on their
   *  matching day (only when viewing today). */
  mealSchedules: readonly MealSchedule[];
  /** Apply a scheduled recipe to a slot on today. */
  onLogScheduled: (schedule: MealSchedule, mealId: number) => void;
  /** Open the AI "what to eat today?" day-suggester. */
  onOpenSuggestDay: () => void;
  /** Open the meal-detail sheet for a slot (macro/micro breakdown). */
  onOpenMealDetail: (mealId: number) => void;
  /** Open the guided "Log meal" sheet — the mobile add-food entry
   *  point. The dense inline AddFoodForm is desktop-only; on mobile
   *  this drives a step-by-step bottom-sheet instead. */
  onOpenLogMeal: () => void;
}

const MealPlanner: React.FC<MealPlannerProps> = ({
  calculatedValues,
  totalMacros,
  macroBreakdown,
  meals,
  selectedDate,
  today,
  waterGoalMl,
  units,
  goalPhase,
  goalPhaseNudge,
  onSelectView,
  onSelectDate,
  newFood,
  foodSearch,
  foodSuggestions,
  pantryItems,
  showSuggestions,
  isSearchingRemote,
  portionSize,
  isGeneratingMealPlan,
  generatingMealId,
  mealPlanMessage,
  coherenceIssues,
  editingFood,
  replacingFood,
  suggestionsRef,
  replacementSuggestionsRef,
  setNewFood,
  setFoodSearch,
  setPortionSize,
  handleFoodSearch,
  handleFoodSelect,
  handlePortionChange,
  handleFoodChange,
  addFood,
  removeFood,
  duplicateFood,
  moveFood,
  startEditingFood,
  cancelEditing,
  handleEditPortionChange,
  saveEditedPortion,
  startReplacingFood,
  cancelReplacing,
  handleReplacementSearch,
  replaceFood,
  generateMealPlan,
  onRefineMealPlan,
  onRegenerateMeal,
  onSaveOffToCustom,
  onOpenCustomFoodForm,
  onOpenCamera,
  onOpenVoice,
  onSaveAsTemplate,
  onAddFromTemplate,
  onApplyRecipe,
  onClearMeal,
  loggedMealSignal,
  mealSchedules,
  onLogScheduled,
  onOpenSuggestDay,
  onOpenMealDetail,
  onOpenLogMeal,
}) => {
  const isError = mealPlanMessage.toLowerCase().includes("error");
  const dayIsEmpty = meals.every((m) => m.foods.length === 0);

  // Schedules that fall on the displayed day — but only surface the "log it"
  // offer when viewing TODAY (the day view is gated to today; you don't log
  // ahead). Empty on past days.
  const daySchedules =
    selectedDate === today ? schedulesForDay(mealSchedules, today) : [];

  // Split coherence issues by scope so the UI can anchor per-meal
  // warnings to the offending card while showing day-level rules
  // (e.g. "total day protein is short") in a single global banner.
  // Compared by exact `name` match because that's how the validator
  // tags them — and MealItem renders the same `meal.name`.
  const dayLevelIssues = coherenceIssues.filter((i) => !i.mealName);
  const issuesByMeal = new Map<string, CoherenceIssue[]>();
  for (const issue of coherenceIssues) {
    if (!issue.mealName) continue;
    const arr = issuesByMeal.get(issue.mealName) ?? [];
    arr.push(issue);
    issuesByMeal.set(issue.mealName, arr);
  }

  // Pending refiner text held while the pre-diabetic disclaimer is
  // open. `null` = dialog closed. The dialog's onAccept fires the
  // refiner with this stored text; cancel drops it. Keeping the
  // pending text alongside the open state means a stale gesture
  // doesn't accidentally fire after a re-render.
  const [pendingPreDiabeticRefinement, setPendingPreDiabeticRefinement] =
    React.useState<string | null>(null);

  function handleRefinerClick(id: string, text: string) {
    if (id === "pre-diabetic" && !hasDismissedPreDiabeticDisclaimer()) {
      setPendingPreDiabeticRefinement(text);
      return;
    }
    void onRefineMealPlan(text);
  }

  // PointerSensor with an 8px activation distance so single clicks on
  // the grip don't get interpreted as drags. KeyboardSensor wires Space
  // + arrow keys for accessibility (the same affordance for non-mouse
  // users).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Track the currently-dragged food so `DragOverlay` can render a clone
  // in a portal - without it the dragged row vanishes the moment the
  // cursor leaves its meal's overflow-clipped table container.
  const [activeFood, setActiveFood] = React.useState<{
    mealId: number;
    foodId: number;
  } | null>(null);
  const activeFoodItem =
    activeFood &&
    meals
      .find((m) => m.id === activeFood.mealId)
      ?.foods.find((f) => f.id === activeFood.foodId);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as
      | { mealId: number; foodId: number }
      | undefined;
    if (data) setActiveFood(data);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveFood(null);
    const { active, over } = event;
    if (!over) return;
    const src = active.data.current as
      | { mealId: number; foodId: number }
      | undefined;
    if (!src) return;

    // The drop target is either another food row (id `mealId:foodId`)
    // or a meal-level droppable (id `meal-${mealId}`, fires when the
    // meal has zero items or you drop in the empty space around them).
    const over_ = over.data.current as
      | { mealId: number; foodId?: number; type?: string }
      | undefined;
    const destMealId = over_?.mealId ?? src.mealId;

    let destIndex: number | undefined;
    if (over_?.foodId !== undefined) {
      const destMeal = meals.find((m) => m.id === destMealId);
      destIndex = destMeal?.foods.findIndex((f) => f.id === over_.foodId);
      if (destIndex === -1) destIndex = undefined;
    }
    moveFood(src.mealId, destMealId, src.foodId, destIndex);
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Active goal phase (Pro) driving today's target. "Now" surface — only
          on today, like the fasting card. */}
      {selectedDate === today && goalPhase && (
        <section className="overflow-hidden rounded-lg border border-brand/30 bg-card">
          <div className="px-3 py-3 sm:px-5 sm:py-4">
            <ActivePhaseBanner
              phase={goalPhase}
              today={today}
              units={units}
              nudge={goalPhaseNudge}
            />
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="px-3 py-3 sm:px-5 sm:py-4">
          <DailyTotals
            calculatedValues={calculatedValues}
            totalMacros={totalMacros}
            breakdown={macroBreakdown}
            selectedDate={selectedDate}
            today={today}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="px-3 py-3 sm:px-5 sm:py-4">
          <WaterCounter
            date={selectedDate}
            goalMl={waterGoalMl}
            units={units}
          />
        </div>
      </section>

      {/* The live fast timer is a "right now" surface — only meaningful on
          today, never on a past/future planned day. */}
      {selectedDate === today && (
        <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
          <div className="px-3 py-3 sm:px-5 sm:py-4">
            <FastingCard onSelectView={onSelectView} />
          </div>
        </section>
      )}

      {/* "Don't know what to eat today?" — an AI day-suggester that picks a
          breakfast/lunch/dinner combo from the user's saved recipes to fit the
          remaining macro targets. Today-only (it logs into today's slots). */}
      {selectedDate === today && (
        <Button
          type="button"
          variant="outline"
          onClick={onOpenSuggestDay}
          className="h-10 w-full gap-1.5"
        >
          <Sparkles className="h-4 w-4 text-primary" />
          Don&apos;t know what to eat today?
        </Button>
      )}

      {/* Mobile add-food entry point: one prominent button that opens
          the guided "Log meal" bottom-sheet. The dense inline form is
          desktop-only — beta testers found it confusing on a phone. */}
      <Button
        type="button"
        onClick={onOpenLogMeal}
        className="h-12 w-full gap-1.5 text-base md:hidden"
      >
        <Plus className="h-5 w-5" />
        Log meal
      </Button>

      <div className="hidden md:block">
        <AddFoodForm
          meals={meals}
          newFood={newFood}
          foodSearch={foodSearch}
          foodSuggestions={foodSuggestions}
          pantryItems={pantryItems}
          showSuggestions={showSuggestions}
          isSearchingRemote={isSearchingRemote}
          portionSize={portionSize}
          suggestionsRef={suggestionsRef}
          setNewFood={setNewFood}
          handleFoodSearch={handleFoodSearch}
          handleFoodSelect={handleFoodSelect}
          handlePortionChange={handlePortionChange}
          handleFoodChange={handleFoodChange}
          addFood={addFood}
          setFoodSearch={setFoodSearch}
          setShowSuggestions={() => {}}
          setPortionSize={setPortionSize}
          onSaveOffToCustom={onSaveOffToCustom}
          onOpenCustomFoodForm={onOpenCustomFoodForm}
          onOpenCamera={onOpenCamera}
          onOpenVoice={onOpenVoice}
        />
      </div>

      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {/* Header stays single-row at every breakpoint. On mobile the
            DateNavigator (prev / date pill / next / Today button)
            takes the left side and Auto-fill collapses to icon-only
            on the right — the label expands at sm+ where there's
            room. Keeping date + action on the same row removes the
            empty-strip gap users were reading as misalignment. */}
        <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
          <DateNavigator
            date={selectedDate}
            today={today}
            onSelect={onSelectDate}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={generateMealPlan}
            disabled={isGeneratingMealPlan}
            aria-label={isGeneratingMealPlan ? "Generating" : "Auto-fill"}
            className="h-9 shrink-0 gap-2 px-2.5 sm:h-8 sm:px-3"
          >
            {isGeneratingMealPlan ? (
              <Loader2 className="h-4 w-4 animate-spin sm:h-3.5 sm:w-3.5" />
            ) : (
              <RefreshCw className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            )}
            <span className="hidden sm:inline">
              {isGeneratingMealPlan ? "Generating…" : "Auto-fill"}
            </span>
          </Button>
        </header>

        <AnimatePresence>
          {mealPlanMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className={`overflow-hidden whitespace-pre-line border-b border-border/60 px-3 py-2.5 text-xs sm:px-5 ${
                isError
                  ? "text-rose-700 dark:text-rose-400"
                  : "text-muted-foreground"
              }`}
            >
              {mealPlanMessage}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Refiner pills - only rendered when there's at least one food
            anywhere in the day's meals (no point asking the AI to
            "lower the sugars" of an empty plan). Each pill is a single
            tap; the busy state is shared with the Auto-fill button via
            `isGeneratingMealPlan`. */}
        {!dayIsEmpty && (
          /* Refiner pills. Mobile wraps into three cramped rows with
             flex-wrap; instead, scroll horizontally on narrow
             viewports so the user sees one neat strip and swipes
             through the chips. Desktop keeps wrap behaviour where
             vertical space is cheaper than the friction of a hidden
             scroll target. `-mx-` + `px-` is the classic "scrollable
             strip flush to card edges but pads its content" trick. */
          <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto border-b border-border/60 bg-muted/20 px-3 py-2 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.75rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-5 sm:py-2.5 sm:[mask-image:none]">
            <span className="mr-1 flex shrink-0 items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Refine
            </span>
            {REFINERS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleRefinerClick(r.id, r.text)}
                disabled={isGeneratingMealPlan}
                className="h-8 shrink-0 rounded-full border border-border/60 bg-background px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-7"
                title={r.text}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {dayIsEmpty && (
          <div className="border-b border-border/60 bg-muted/20 px-3 py-3 text-xs text-muted-foreground sm:px-5">
            <span className="font-medium text-foreground">
              No meals logged for this day.
            </span>{" "}
            Use the search above to add foods to any meal, apply a saved
            template from a meal&apos;s menu, or hit{" "}
            <span className="font-medium text-foreground">Auto-fill</span> to
            generate a plan that matches your macros.
          </div>
        )}

        {/* Day-level coherence warnings (e.g. low-day-protein). Shown
            above the meals as a banner because they apply to the whole
            plan, not a single slot. The "Try refining" button fires
            the matching refiner pill text directly; if the issue isn't
            one we have a canned refiner for, the button falls back to a
            generic refinement using the issue message verbatim. */}
        {dayLevelIssues.length > 0 && (
          <div className="space-y-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs sm:px-5">
            {dayLevelIssues.map((issue, idx) => (
              <div
                key={`${issue.code}-${idx}`}
                className="flex items-start gap-2"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex flex-col gap-1.5">
                  <p className="text-amber-900 dark:text-amber-100">
                    {issue.message}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      onRefineMealPlan(
                        issue.code === "low-day-protein"
                          ? "Add more protein across the day"
                          : issue.message,
                      )
                    }
                    disabled={isGeneratingMealPlan}
                    className="self-start rounded-full border border-amber-600/40 bg-background px-2.5 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-900/30"
                  >
                    Try refining
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveFood(null)}
        >
          <DragOverlay dropAnimation={null}>
            {activeFoodItem ? (
              <div className="pointer-events-none flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 shadow-lg ring-1 ring-foreground/5">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {activeFoodItem.name}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {activeFoodItem.portionSize
                    ? `${activeFoodItem.portionSize} g · `
                    : ""}
                  {activeFoodItem.calories} kcal
                </span>
              </div>
            ) : null}
          </DragOverlay>

          <div className="divide-y divide-border/60">
            {meals.map((meal) => (
              <MealItem
                key={meal.id}
                meal={meal}
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
                onSaveAsTemplate={onSaveAsTemplate}
                onAddFromTemplate={onAddFromTemplate}
                onApplyRecipe={onApplyRecipe}
                onClearMeal={onClearMeal}
                loggedSignal={loggedMealSignal}
                scheduledForSlot={daySchedules.find((s) =>
                  scheduleTargetsSlot(s, meal.name),
                )}
                onLogScheduled={onLogScheduled}
                onOpenDetail={onOpenMealDetail}
                onRegenerate={onRegenerateMeal}
                regenerating={isGeneratingMealPlan}
                regeneratingThisMeal={generatingMealId === meal.id}
                issues={issuesByMeal.get(meal.name) ?? []}
              />
            ))}
          </div>
        </DndContext>
      </section>

      <PreDiabeticDisclaimerDialog
        open={pendingPreDiabeticRefinement !== null}
        onOpenChange={(o) => {
          if (!o) setPendingPreDiabeticRefinement(null);
        }}
        onAccept={() => {
          const text = pendingPreDiabeticRefinement;
          setPendingPreDiabeticRefinement(null);
          if (text) void onRefineMealPlan(text);
        }}
      />

      {/* Thumb-zone quick-add: opens the guided Log meal sheet from
          anywhere in the list. Mobile-only. */}
      <QuickAddFab onOpen={onOpenLogMeal} />
    </div>
  );
};

export default MealPlanner;
