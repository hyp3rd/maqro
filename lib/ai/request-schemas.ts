import {
  AI_MAX_BIAS_ITEMS,
  AI_MAX_CUSTOM_FOODS,
  AI_MAX_LABEL_CHARS,
  AI_MAX_NAME_CHARS,
  AI_MAX_TAGS,
  AI_MAX_UNIT_CHARS,
} from "@/lib/ai/request-limits";
import { z } from "zod";

/** Zod pieces shared by the AI routes' request schemas, each bounded by
 *  [request-limits.ts](./request-limits.ts). Every string and list here is
 *  rendered into a model prompt, so none may be unbounded. */

/** A food name that reaches a prompt (catalog line, plan context). */
export const AiFoodName = z.string().min(1).max(AI_MAX_NAME_CHARS);

/** One of the user's custom foods, as the clients send it. Validates the
 *  fields the prompt renders (name, macros, category); `.loose()` lets the
 *  rest of the Food record (dietKind, breakdown, brand) through for the
 *  catalog and plan helpers, bounded overall by the route's body cap.
 *  `category` may be null on records synced from the server. */
export const CustomFoodWire = z
  .object({
    name: AiFoodName,
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    calories: z.number(),
    category: z.string().max(AI_MAX_LABEL_CHARS).nullish(),
  })
  .loose();

export const CustomFoodsWire = z.array(CustomFoodWire).max(AI_MAX_CUSTOM_FOODS);

/** Cuisine preferences, allergies, disliked foods. */
export const PreferenceTagsWire = z
  .array(z.string().max(AI_MAX_LABEL_CHARS))
  .max(AI_MAX_TAGS);

/** Recently-eaten rotation (soft bias): name × times eaten. */
export const RecentlyEatenWire = z
  .array(
    z.object({ name: z.string().max(AI_MAX_NAME_CHARS), count: z.number() }),
  )
  .max(AI_MAX_BIAS_ITEMS);

/** Pantry on hand (soft bias). */
export const PantryBiasWire = z
  .array(
    z.object({
      name: z.string().max(AI_MAX_NAME_CHARS),
      quantity: z.number(),
      unit: z.string().max(AI_MAX_UNIT_CHARS),
    }),
  )
  .max(AI_MAX_BIAS_ITEMS);
