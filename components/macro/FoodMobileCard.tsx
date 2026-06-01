"use client";

import { useDoubleTap } from "@/hooks/use-double-tap";
import React from "react";
import { Edit2, GripVertical, Search, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Food, FoodItem as FoodItemType } from "./types";

/** Mobile-first card layout for a food row in a meal slot. Counterpart
 *  to [FoodItem.tsx](./FoodItem.tsx) which renders the same data as a
 *  dense `<tr>` for sm+ viewports.
 *
 *  MealItem mounts both - the mobile card under `sm:hidden`, the table
 *  row under `hidden sm:table-row` - so each viewport gets the layout
 *  built for it. dnd-kit's SortableContext sees both registrations per
 *  food id, but only the visible variant participates in hit-testing.
 *  Same pattern as MyFoodsView's FoodMobileCard / FoodTableRow split. */
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
  const isEditing = editingFood.foodId === food.id;
  // Pull the edit row above the iOS soft keyboard once edit mode
  // engages. Without this scroll, iOS just focuses the input and
  // leaves the row covered by the keyboard + its prediction toolbar,
  // hiding the Save / Cancel buttons. We wait one tick after focus
  // so iOS finishes resizing the visual viewport before we scroll —
  // measuring before the resize lands wrong every time. `block:
  // 'center'` is the magic value: 'nearest' is a no-op here because
  // the row is technically "in view" already (just under the
  // keyboard), and 'start' jams the row against the top safe-area.
  const editInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!isEditing) return;
    const t = setTimeout(() => {
      editInputRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 300);
    return () => clearTimeout(t);
  }, [isEditing]);
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

  // Double-tap the food's name / macros to duplicate it ("I ate two of
  // these"). No single-tap action — the content area isn't otherwise
  // interactive (the buttons handle replace / edit / remove), so the
  // hook fires only on the double and never delays anything.
  const { onPointerUp: onContentPointerUp } = useDoubleTap({
    onDoubleTap: () => duplicateFood(mealId, food.id),
  });

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
      className="flex items-start gap-2 px-3 py-3 active:bg-muted/30"
    >
      <button
        type="button"
        aria-label={`Drag ${food.name}`}
        className="flex h-10 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
        disabled={isEditing}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Double-tap target. Only armed when not editing (the edit input
          lives here in edit mode and must receive taps normally). */}
      <div
        className="min-w-0 flex-1 space-y-1"
        onPointerUp={isEditing ? undefined : onContentPointerUp}
      >
        <p className="truncate text-sm font-medium text-foreground">
          {food.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          {isEditing ? (
            <Input
              ref={editInputRef}
              type="number"
              value={editingFood.portionSize}
              onChange={handleEditPortionChange}
              className="h-8 w-20 px-2 text-right font-mono text-sm tabular-nums"
              min="1"
              max="1000"
              autoFocus
            />
          ) : (
            <span className="font-medium text-foreground">
              {food.portionSize ?? "–"}
              {food.portionSize ? "g" : ""}
            </span>
          )}
          <span className="text-muted-foreground/70">·</span>
          <span className="font-medium text-foreground">
            {food.calories} kcal
          </span>
          <span className="text-muted-foreground/70">·</span>
          <span style={{ color: "hsl(var(--macro-protein))" }}>
            P{food.protein}
          </span>
          <span style={{ color: "hsl(var(--macro-carbs))" }}>
            C{food.carbs}
          </span>
          <span style={{ color: "hsl(var(--macro-fat))" }}>F{food.fat}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {isEditing ? (
          <>
            <Button
              type="button"
              onClick={saveEditedPortion}
              variant="default"
              size="sm"
              className="h-9 px-3 text-xs"
            >
              Save
            </Button>
            <Button
              type="button"
              onClick={cancelEditing}
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs"
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              onClick={() => startReplacingFood(mealId, food)}
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground"
              aria-label={`Replace ${food.name}`}
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              onClick={() => startEditingFood(mealId, food)}
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground"
              aria-label={`Edit portion of ${food.name}`}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              onClick={() => removeFood(mealId, food.id)}
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${food.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
};

export default FoodMobileCard;
