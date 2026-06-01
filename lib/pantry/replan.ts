import type { FoodItem, Meal } from "@/components/macro/types";
import type { PantryItem } from "@/lib/db";
import { planPerFoodConsumption, roundQuantity } from "./consume";

/** Compute the signed pantry delta when a day's meals are replaced
 *  wholesale — AI auto-fill, AI refinement, the deterministic fallback
 *  planner; anywhere a whole-day plan blows away the prior plan via
 *  `setMeals(newMeals)` rather than appending to it.
 *
 *  Two pieces of accounting, netted into one map:
 *
 *  - **Restore** every `pantrySource` stamp on `oldMeals` foods, since
 *    those foods are about to be discarded.
 *  - **Draw** the `newMeals` foods against the pantry plus the about-
 *    to-be-restored quantities, so an item the user just gave back can
 *    be drawn again by the new plan if it matches. Stamps land
 *    directly on the FoodItem objects in `newMeals` — mutation is
 *    intentional (these are caller-owned drafts from the AI response
 *    or planner output, not React state) and the caller's
 *    `setMeals(newMeals)` makes the stamps visible.
 *
 *  Returns a single `Map<itemId, signedDelta>`. Positive deltas are
 *  draws, negative deltas are restores, items that net to zero are
 *  dropped. Feed straight into `applyPantryDelta`. */
export function replanPantryDeltas(
  oldMeals: Meal[],
  newMeals: Meal[],
  pantryItems: PantryItem[],
): Map<string, number> {
  const restoreByItem = new Map<string, number>();
  for (const meal of oldMeals) {
    for (const food of meal.foods) {
      const src = food.pantrySource;
      if (!src) continue;
      restoreByItem.set(
        src.itemId,
        roundQuantity((restoreByItem.get(src.itemId) ?? 0) + src.consumedQty),
      );
    }
  }

  const adjustedItems = pantryItems.map((i) => ({
    ...i,
    quantity: roundQuantity(i.quantity + (restoreByItem.get(i.id) ?? 0)),
  }));

  const allNewFoods = newMeals.flatMap((m) => m.foods);
  const draws = planPerFoodConsumption(
    allNewFoods.map((f) => ({ name: f.name, grams: f.portionSize })),
    adjustedItems,
  );
  const drawByItem = new Map<string, number>();
  allNewFoods.forEach((food: FoodItem, i) => {
    const d = draws[i];
    if (!d) return;
    food.pantrySource = d;
    drawByItem.set(
      d.itemId,
      roundQuantity((drawByItem.get(d.itemId) ?? 0) + d.consumedQty),
    );
  });

  const netByItem = new Map<string, number>();
  for (const [id, qty] of restoreByItem) netByItem.set(id, -qty);
  for (const [id, qty] of drawByItem) {
    netByItem.set(id, roundQuantity((netByItem.get(id) ?? 0) + qty));
  }
  for (const [id, net] of netByItem) {
    if (net === 0) netByItem.delete(id);
  }
  return netByItem;
}
