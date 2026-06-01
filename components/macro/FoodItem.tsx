import React from "react";
import { Edit2, GripVertical, Search, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Food, FoodItem as FoodItemType } from "../../components/macro/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface FoodItemProps {
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
}

const FoodItem: React.FC<FoodItemProps> = ({
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
}) => {
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
    // Disable dragging while editing/replacing so input clicks aren't
    // hijacked by the drag sensor.
    disabled: isEditing || isReplacing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="transition-colors hover:bg-muted/40"
    >
      <td className="w-8 px-1 py-2.5 align-middle">
        <button
          type="button"
          aria-label={`Drag ${food.name}`}
          className="flex h-7 w-6 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
          disabled={isEditing || isReplacing}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {isReplacing ? (
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
                className="h-9 pl-9"
                placeholder="Search for food..."
                autoFocus
              />
            </div>
            {replacingFood.showSuggestions &&
              replacingFood.suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border/60 bg-popover shadow-lg">
                  <ul className="py-1">
                    {replacingFood.suggestions.map((suggestion, index) => (
                      <li
                        key={index}
                        className="cursor-pointer px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                        onClick={() => replaceFood(suggestion)}
                      >
                        {suggestion.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        ) : (
          <span className="text-foreground">{food.name}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center font-mono text-xs tabular-nums text-muted-foreground">
        {isEditing ? (
          <Input
            type="number"
            value={editingFood.portionSize}
            onChange={handleEditPortionChange}
            className="mx-auto h-8 w-20 text-center"
            min="1"
            max="1000"
          />
        ) : (
          (food.portionSize ?? "-") + (food.portionSize ? "g" : "")
        )}
      </td>
      <td
        className="px-3 py-2.5 text-center font-mono text-xs tabular-nums"
        style={{ color: "hsl(var(--macro-protein))" }}
      >
        {food.protein}g
      </td>
      <td
        className="px-3 py-2.5 text-center font-mono text-xs tabular-nums"
        style={{ color: "hsl(var(--macro-carbs))" }}
      >
        {food.carbs}g
      </td>
      <td
        className="px-3 py-2.5 text-center font-mono text-xs tabular-nums"
        style={{ color: "hsl(var(--macro-fat))" }}
      >
        {food.fat}g
      </td>
      <td className="px-3 py-2.5 text-center font-mono text-xs font-medium tabular-nums text-foreground">
        {food.calories}
      </td>
      <td className="px-3 py-2.5 text-right">
        {isEditing ? (
          <div className="flex items-center justify-end gap-1">
            <Button
              onClick={saveEditedPortion}
              variant="ghost"
              size="sm"
              className="h-7"
            >
              Save
            </Button>
            <Button
              onClick={cancelEditing}
              variant="ghost"
              size="sm"
              className="h-7"
            >
              Cancel
            </Button>
          </div>
        ) : isReplacing ? (
          <Button
            onClick={cancelReplacing}
            variant="ghost"
            size="sm"
            className="h-7"
          >
            Cancel
          </Button>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => startReplacingFood(mealId, food)}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Replace food</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => startEditingFood(mealId, food)}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit portion</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => removeFood(mealId, food.id)}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove food</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </td>
    </tr>
  );
};

export default FoodItem;
