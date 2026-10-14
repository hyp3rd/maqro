import {
  AI_MAX_BIAS_ITEMS,
  AI_MAX_CUSTOM_FOODS,
  AI_MAX_LABEL_CHARS,
  AI_MAX_NAME_CHARS,
  AI_MAX_UNIT_CHARS,
} from "@/lib/ai/request-limits";
import type { Food } from "@maqro/core/types";

/** Client-side half of the AI request size limits.
 *
 *  The routes reject any over-limit string or list
 *  (lib/ai/request-schemas.ts), but the data the clients send has no
 *  length bound where it is stored: custom-food names are copied verbatim
 *  from Open Food Facts or typed into an unbounded input, logged foods
 *  keep their OFF names, and tags / pantry items are free-form. These
 *  builders fit that data to the limits before it is sent, exactly as
 *  the item counts were already clamped, so a long name never turns a
 *  legitimate request into a 400.
 *
 *  Truncating is safe for every field here: they are prompt context or
 *  catalog names, and the route resolves the model's picks against the
 *  same truncated names it was sent. Meal-slot names are deliberately
 *  NOT clamped: they are app-defined ("Breakfast" ...), and the planner
 *  matches the returned meal back to its slot by exact name. */

/** First `max` UTF-16 code units of `text` (the unit zod's `.max` counts),
 *  backing off one unit rather than splitting a surrogate pair. */
export function clampAiText(text: string, max: number): string {
  if (text.length <= max) return text;
  const lastKept = text.charCodeAt(max - 1);
  const splitsPair = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return text.slice(0, splitsPair ? max - 1 : max);
}

/** A food with its prompt-rendered labels (`name`, `category`) fitted to
 *  the limits; every other field passes through untouched. `category` may
 *  be null on records synced from the server. */
export function clampAiFoodLabels<
  T extends { name: string; category?: string | null },
>(food: T): T {
  return {
    ...food,
    name: clampAiText(food.name, AI_MAX_NAME_CHARS),
    ...(typeof food.category === "string"
      ? { category: clampAiText(food.category, AI_MAX_LABEL_CHARS) }
      : {}),
  };
}

/** The custom-food fields the photo, voice and recipe routes read. */
export type AiCustomFood = Pick<
  Food,
  | "name"
  | "protein"
  | "carbs"
  | "fat"
  | "calories"
  | "category"
  | "subCategory"
  | "brand"
  | "dietKind"
>;

/** The user's custom foods as the AI routes accept them: at most
 *  AI_MAX_CUSTOM_FOODS (callers pass `listCustomFoods` order, newest
 *  first, so the newest survive), reduced to the fields the routes read,
 *  with their labels clamped. */
export function toAiCustomFoods(
  customs: readonly AiCustomFood[],
): AiCustomFood[] {
  return customs
    .slice(0, AI_MAX_CUSTOM_FOODS)
    .map((c) =>
      clampAiFoodLabels({
        name: c.name,
        protein: c.protein,
        carbs: c.carbs,
        fat: c.fat,
        calories: c.calories,
        category: c.category,
        subCategory: c.subCategory,
        brand: c.brand,
        dietKind: c.dietKind,
      }),
    );
}

/** Cuisine / allergy / dislike tags with each tag clamped. The COUNT is
 *  deliberately not clamped: dropping allergy tags would silently disable
 *  the route's allergen filter for them, whereas a clamped tag is a prefix
 *  of the original and filters at least as much. */
export function toAiPreferenceTags(tags: readonly string[]): string[] {
  return tags.map((t) => clampAiText(t, AI_MAX_LABEL_CHARS));
}

/** Recently-eaten rotation (soft bias), clamped. */
export function toAiRecentlyEaten(
  foods: readonly { name: string; count: number }[],
): { name: string; count: number }[] {
  return foods
    .slice(0, AI_MAX_BIAS_ITEMS)
    .map((f) => ({
      name: clampAiText(f.name, AI_MAX_NAME_CHARS),
      count: f.count,
    }));
}

/** Pantry on hand (soft bias), clamped. */
export function toAiPantryBias(
  items: readonly { name: string; quantity: number; unit: string }[],
): { name: string; quantity: number; unit: string }[] {
  return items
    .slice(0, AI_MAX_BIAS_ITEMS)
    .map((p) => ({
      name: clampAiText(p.name, AI_MAX_NAME_CHARS),
      quantity: p.quantity,
      unit: clampAiText(p.unit, AI_MAX_UNIT_CHARS),
    }));
}
