"use client";

import React, { useState } from "react";
import {
  ChevronRight,
  Copy,
  GripVertical,
  Minus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SheetAction, SheetConfirm } from "./SheetAction";
import { Food, FoodItem as FoodItemType } from "./types";

/** Mobile-first food row in a meal slot.
 *
 *  The whole row is a single large tap target; tapping it opens a
 *  bottom-sheet with big, labelled actions (Edit portion / Replace /
 *  Duplicate / Remove) — instead of cramming a cluster of ~32px icon
 *  buttons into the row the way the desktop table does. "Edit portion"
 *  becomes a focused step inside the sheet (a stepper + numeric field, no
 *  squinting at a tiny inline input). Drag-to-reorder stays on the left
 *  grip; "Replace" still takes over the card with a search field (shared
 *  with the desktop row). Counterpart to [FoodItem.tsx](./FoodItem.tsx),
 *  the dense `<tr>` rendered for sm+ viewports. */
interface Props {
  food: FoodItemType;
  mealId: number;
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
}

const FoodMobileCard: React.FC<Props> = ({
  food,
  mealId,
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
}) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Remove asks for an in-sheet confirm step before deleting, so every
  // delete is a bottom-sheet confirmation (never a silent removal).
  const [confirming, setConfirming] = useState(false);
  const isEditing = editingFood.foodId === food.id;
  const isReplacing = replacingFood.foodId === food.id;
  const sortableId = `${mealId}:${food.id}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    data: { mealId, foodId: food.id },
    disabled: isEditing || isReplacing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // The macro summary — reused verbatim in the collapsed row and the
  // sheet header so the user sees the same line they tapped.
  const macroLine = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular-nums">
      <span className="text-foreground">
        {food.portionSize ? `${food.portionSize} g` : "–"}
      </span>
      <span className="text-muted-foreground/50">·</span>
      <span className="text-foreground">{food.calories} kcal</span>
      <span className="text-muted-foreground/50">·</span>
      <span style={{ color: "hsl(var(--macro-protein))" }}>
        P{food.protein}
      </span>
      <span style={{ color: "hsl(var(--macro-carbs))" }}>C{food.carbs}</span>
      <span style={{ color: "hsl(var(--macro-fat))" }}>F{food.fat}</span>
    </span>
  );

  // Nudge the portion up/down in 5g steps from the stepper buttons. We
  // reuse the parent's change handler (it owns the editingFood state +
  // the live macro recompute) by handing it a synthetic input value.
  function bumpPortion(delta: number) {
    const next = Math.max(
      1,
      Math.min(2000, (editingFood.portionSize || 0) + delta),
    );
    handleEditPortionChange({
      target: { value: String(next) },
    } as React.ChangeEvent<HTMLInputElement>);
  }

  function closeSheet() {
    // Closing mid-edit discards the edit (matches the old Cancel button).
    if (isEditing) cancelEditing();
    setConfirming(false);
    setSheetOpen(false);
  }

  // Replace mode takes over the whole card - search input + suggestion
  // dropdown. Same affordance as the desktop row.
  if (isReplacing) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className="px-3 py-3"
      >
        <div
          className="relative"
          ref={replacementSuggestionsRef}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={replacingFood.searchTerm}
              onChange={handleReplacementSearch}
              className="h-10 pl-9 pr-20"
              placeholder={`Replace ${food.name}…`}
              autoFocus
            />
            <Button
              type="button"
              onClick={cancelReplacing}
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 h-8 -translate-y-1/2"
            >
              Cancel
            </Button>
          </div>
          {replacingFood.showSuggestions &&
            replacingFood.suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border/60 bg-popover py-1 shadow-lg">
                {replacingFood.suggestions.map((suggestion, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => replaceFood(suggestion)}
                      className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      {suggestion.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-stretch gap-1 px-2"
    >
      <button
        type="button"
        aria-label={`Drag ${food.name}`}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* The whole content is the tap target → opens the action sheet. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label={`${food.name} — open actions`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2.5 pr-1 text-left transition-colors active:bg-muted/40"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {food.name}
          </span>
          {macroLine}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
      </button>

      <Dialog
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      >
        <DialogContent className="gap-3">
          <DialogHeader>
            <DialogTitle className="truncate pr-6 text-left">
              {food.name}
            </DialogTitle>
            <DialogDescription
              asChild
              className="text-left"
            >
              <div>{macroLine}</div>
            </DialogDescription>
          </DialogHeader>

          {confirming ? (
            <SheetConfirm
              title={`Remove ${food.name}?`}
              description="This food will be removed from the meal."
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                removeFood(mealId, food.id);
                setConfirming(false);
                setSheetOpen(false);
              }}
            />
          ) : isEditing ? (
            <div className="space-y-4 pt-1">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Portion (grams)
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 shrink-0"
                    onClick={() => bumpPortion(-5)}
                    aria-label="Decrease portion by 5 grams"
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={editingFood.portionSize}
                    onChange={handleEditPortionChange}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditedPortion();
                    }}
                    className="h-12 flex-1 text-center font-mono text-lg tabular-nums"
                    min="1"
                    max="2000"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 shrink-0"
                    onClick={() => bumpPortion(5)}
                    aria-label="Increase portion by 5 grams"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-12 flex-1"
                  onClick={() => cancelEditing()}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="h-12 flex-1"
                  onClick={() => {
                    saveEditedPortion();
                    setSheetOpen(false);
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5 pt-1">
              <SheetAction
                icon={SlidersHorizontal}
                label="Edit portion"
                hasNext
                onClick={() => startEditingFood(mealId, food)}
              />
              <SheetAction
                icon={RefreshCw}
                label="Replace food"
                hasNext
                onClick={() => {
                  setSheetOpen(false);
                  startReplacingFood(mealId, food);
                }}
              />
              <SheetAction
                icon={Copy}
                label="Duplicate"
                onClick={() => {
                  duplicateFood(mealId, food.id);
                  setSheetOpen(false);
                }}
              />
              <SheetAction
                icon={Trash2}
                label="Remove"
                destructive
                onClick={() => setConfirming(true)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
};

export default FoodMobileCard;
