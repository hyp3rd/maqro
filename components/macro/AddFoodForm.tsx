"use client";

import type { PantryItem } from "@/lib/db";
import { mealIcon } from "@/lib/meal-icon";
import { matchPantryItem } from "@/lib/pantry/consume";
import { cn } from "@/lib/utils";
import React, { useState } from "react";
import { Loader2, Mic, Plus, Save, ScanLine, Search } from "lucide-react";
import { toast } from "sonner";
import { Food, FoodItem, Meal } from "../../components/macro/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { OffSavePreviewDialog } from "./OffSavePreviewDialog";

interface AddFoodFormProps {
  meals: Meal[];
  newFood: FoodItem;
  foodSearch: string;
  foodSuggestions: Food[];
  /** Live pantry inventory. A search result whose name matches an item
   *  here gets an "In pantry" badge so the user is nudged to use what
   *  they already have. */
  pantryItems: PantryItem[];
  showSuggestions: boolean;
  portionSize: number;
  isSearchingRemote: boolean;
  suggestionsRef: React.RefObject<HTMLDivElement | null>;
  setFoodSearch: (value: string) => void;
  setNewFood: (food: FoodItem) => void;
  setShowSuggestions: (show: boolean) => void;
  setPortionSize: (size: number) => void;
  handleFoodSearch: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFoodSelect: (food: Food) => void;
  handlePortionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFoodChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  addFood: () => void;
  onSaveOffToCustom: (food: Food) => void;
  onOpenCustomFoodForm: () => void;
  onOpenCamera: () => void;
  /** When provided, shows a mic-button affordance next to the
   *  camera trigger. Opens the VoiceLogSheet (parent owns the
   *  state + downstream review dialog). Omit to hide the
   *  affordance — useful where AI isn't configured or where
   *  voice doesn't fit (e.g. /foods catalog browsing). */
  onOpenVoice?: () => void;
}

const SOURCE_LABEL: Record<NonNullable<Food["source"]>, string> = {
  builtin: "Built-in",
  custom: "My food",
  off: "Open Food Facts",
};

const SOURCE_CLASS: Record<NonNullable<Food["source"]>, string> = {
  builtin: "bg-muted text-muted-foreground hover:bg-muted",
  custom: "bg-foreground/10 text-foreground hover:bg-foreground/10",
  off: "bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400",
};

const AddFoodForm: React.FC<AddFoodFormProps> = ({
  meals,
  newFood,
  foodSearch,
  foodSuggestions,
  pantryItems,
  showSuggestions,
  portionSize,
  isSearchingRemote,
  suggestionsRef,
  setNewFood,
  handleFoodSearch,
  handleFoodSelect,
  handlePortionChange,
  handleFoodChange,
  addFood,
  onSaveOffToCustom,
  onOpenCustomFoodForm,
  onOpenCamera,
  onOpenVoice,
}) => {
  // Preview-and-save flow for OFF results - instead of one-click
  // saving with just the search-result macros, the dialog fetches
  // the full breakdown via `/api/off-barcode` and lets the user
  // confirm. Holds the food being previewed; null = closed.
  const [previewingOff, setPreviewingOff] = useState<Food | null>(null);

  /** Wrapper around the parent's addFood: fires a toast describing
   *  what just landed in which meal slot so the user has continuous
   *  feedback when adding several foods in a row. The destination
   *  meal name is looked up from `meals[selectedMealId]` so the
   *  message stays specific. */
  function handleAddFood() {
    const trimmed = foodSearch.trim();
    if (!trimmed) {
      addFood();
      return;
    }
    const destMealId = Number.parseInt(
      newFood.selectedMealId?.toString() ?? "0",
      10,
    );
    const dest = meals.find((m) => m.id === destMealId);
    addFood();
    if (dest) {
      toast.success(
        `Added ${trimmed} (${portionSize} g, ${newFood.calories} kcal) to ${dest.name}`,
      );
    }
  }

  /** Persist the (possibly enriched) OFF food via the parent's
   *  callback, then surface the result as a toast. The parent
   *  handler is responsible for the IDB write + sync bump. */
  async function handleConfirmOffSave(food: Food) {
    await onSaveOffToCustom(food);
    toast.success(`Saved ${food.name} to My Foods`);
  }

  return (
    <section
      id="add-food-form"
      className="overflow-hidden rounded-lg border border-border/60 bg-card"
    >
      {/* Stack vertically on narrow screens (the description + two
          buttons crammed onto one row looks awkward). From sm up,
          restore the side-by-side layout. */}
      <header className="flex flex-col gap-2 border-b border-border/60 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2 sm:px-5 sm:py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">Add Food</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Search built-in, your saved foods, and Open Food Facts.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-nowrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenCamera}
            className="h-8 gap-1.5 coarse:h-10"
            title="Scan a product barcode"
          >
            <ScanLine className="h-3.5 w-3.5" />
            Scan
          </Button>
          {onOpenVoice && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenVoice}
              className="h-8 gap-1.5 coarse:h-10"
              title="Talk to log a meal"
            >
              <Mic className="h-3.5 w-3.5" />
              Talk
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenCustomFoodForm}
            className="h-8 gap-1.5 coarse:h-10"
          >
            <Plus className="h-3.5 w-3.5" />
            Custom food
          </Button>
        </div>
      </header>

      <div className="space-y-4 px-3 py-3 sm:px-5 sm:py-4">
        {/* Search */}
        <div
          ref={suggestionsRef}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="foodSearch"
            type="text"
            value={foodSearch}
            onChange={handleFoodSearch}
            placeholder="Search for a food…"
            className="pl-9 pr-9"
          />
          {isSearchingRemote && (
            <Loader2
              aria-label="Searching Open Food Facts"
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          )}

          {showSuggestions && foodSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border border-border/60 bg-popover shadow-lg">
              <ul className="py-1">
                {foodSuggestions.map((food) => {
                  const inPantry = matchPantryItem(food.name, pantryItems);
                  return (
                    <li
                      key={food.id ?? food.name}
                      className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent"
                    >
                      <button
                        type="button"
                        onClick={() => handleFoodSelect(food)}
                        className="flex-1 text-left text-sm"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate">{food.name}</span>
                          {food.source && (
                            <Badge
                              variant="secondary"
                              className={`${SOURCE_CLASS[food.source]} shrink-0 text-[10px] font-medium uppercase tracking-wide`}
                            >
                              {SOURCE_LABEL[food.source]}
                            </Badge>
                          )}
                          {inPantry && (
                            <Badge
                              variant="secondary"
                              className="shrink-0 bg-emerald-500/15 text-[10px] font-medium uppercase tracking-wide text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400"
                            >
                              In pantry: {inPantry.quantity} {inPantry.unit}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {Math.round(food.calories)} kcal · P{" "}
                          {food.protein.toFixed(1)}g · C {food.carbs.toFixed(1)}
                          g · F {food.fat.toFixed(1)}g
                          <span className="ml-1 text-muted-foreground/60">
                            / 100g
                          </span>
                        </div>
                      </button>
                      {food.source === "off" && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewingOff(food);
                          }}
                          className="h-9 w-9 sm:h-8 sm:w-8"
                          aria-label={`Preview and save ${food.name} to my foods`}
                          title="Preview & save to My Foods"
                        >
                          <Save className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Macros for the picked food at the chosen portion */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <FieldNum
            id="portionSize"
            label="Portion"
            unit="g"
            value={portionSize}
            onChange={handlePortionChange}
            min={0}
            step={1}
          />
          <FieldNum
            id="protein"
            name="protein"
            label="Protein"
            unit="g"
            value={newFood.protein}
            onChange={handleFoodChange}
            min={0}
            step={0.1}
          />
          <FieldNum
            id="carbs"
            name="carbs"
            label="Carbs"
            unit="g"
            value={newFood.carbs}
            onChange={handleFoodChange}
            min={0}
            step={0.1}
          />
          <FieldNum
            id="fat"
            name="fat"
            label="Fat"
            unit="g"
            value={newFood.fat}
            onChange={handleFoodChange}
            min={0}
            step={0.1}
          />
          <FieldNum
            id="calories"
            name="calories"
            label="kcal"
            unit=""
            value={newFood.calories}
            onChange={handleFoodChange}
            readOnly
          />
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Add to Meal
            </Label>
            {/* Icon tiles instead of a dropdown — the target meal is one
                tap away and the selection is visible at a glance, matching
                the mobile guided "Log meal" flow. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {meals.map((meal) => {
                const selected = newFood.selectedMealId === meal.id;
                const Icon = mealIcon(meal.name);
                return (
                  <button
                    key={meal.id}
                    type="button"
                    onClick={() =>
                      setNewFood({ ...newFood, selectedMealId: meal.id })
                    }
                    aria-pressed={selected}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border/60 bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{meal.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex sm:justify-end">
            <Button
              type="button"
              onClick={handleAddFood}
              className="h-10 w-full gap-1.5 sm:h-9 sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              Add to meal
            </Button>
          </div>
        </div>
      </div>

      <OffSavePreviewDialog
        open={previewingOff !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewingOff(null);
        }}
        food={previewingOff}
        onSave={handleConfirmOffSave}
      />
    </section>
  );
};

function FieldNum({
  id,
  name,
  label,
  unit,
  value,
  onChange,
  min,
  step,
  readOnly,
}: {
  id: string;
  name?: string;
  label: string;
  unit: string;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  min?: number;
  step?: number;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="flex items-baseline justify-between text-xs font-medium text-muted-foreground"
      >
        <span>{label}</span>
        {unit && (
          <span className="text-[10px] text-muted-foreground/60">{unit}</span>
        )}
      </Label>
      <Input
        id={id}
        name={name}
        type="number"
        value={value}
        onChange={onChange}
        min={min}
        step={step}
        readOnly={readOnly}
        className={`font-mono tabular-nums ${
          readOnly ? "bg-muted/50 text-muted-foreground" : ""
        }`}
      />
    </div>
  );
}

export default AddFoodForm;
