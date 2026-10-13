/** Size limits for the AI routes' request bodies.
 *
 *  Why they exist: the monthly AI quota counts requests, not tokens, and
 *  every field below is pasted into a model prompt. Without caps, one
 *  metered credit could carry a multi-megabyte `refinement` or catalog
 *  into Sonnet's 1M-token window (dollars per call, and enough input
 *  tokens per minute to rate-limit every other user). With them, a
 *  request's prompt stays within a small multiple of a normal one.
 *
 *  How they were sized: from what the app legitimately sends, with
 *  headroom, so normal use never trips them. Server schemas enforce them
 *  (lib/ai/request-schemas.ts and each route's BodySchema); clients that
 *  send open-ended lists clamp to them before sending.
 *
 *  Plain constants, no zod: client components import this module. */

/** Food, ingredient, recipe and pantry-item names. Matches the existing
 *  server caps for the same names (micronutrient-enqueue `nameKey`,
 *  shopping/suggest item names). */
export const AI_MAX_NAME_CHARS = 200;

/** Short labels: meal-slot names, categories, cuisines, diet tags,
 *  allergy / dislike tags, ids. */
export const AI_MAX_LABEL_CHARS = 100;

/** Units on pantry items ("cans", "g", "bag"); same cap as
 *  shopping/suggest. */
export const AI_MAX_UNIT_CHARS = 40;

/** Entries per preference list (cuisines, allergies, disliked foods). The
 *  cuisine picker offers a fixed list well under this; allergies and
 *  dislikes are free-form tags. */
export const AI_MAX_TAGS = 100;

/** Custom foods per request. Clients send their newest custom foods
 *  (`listCustomFoods` is newest-first) clamped to this. */
export const AI_MAX_CUSTOM_FOODS = 500;

/** Meal slots in a day. The planner has four fixed slots; suggest-day
 *  already capped at 8. */
export const AI_MAX_MEAL_SLOTS = 8;

/** Foods within one meal sent as context (meal-plan `previousMeals`). */
export const AI_MAX_FOODS_PER_MEAL = 100;

/** Soft-bias lists (recently eaten foods, pantry on hand). The routes
 *  render at most the first 30 into the prompt; this only bounds the
 *  list a client can upload. */
export const AI_MAX_BIAS_ITEMS = 500;

/** Meal-plan refinement text. Refinements come from the canned refiner
 *  pills (lib/ai/refiners.ts, longest ~740 chars) or a coherence-issue
 *  message (meal + food names + one sentence). */
export const AI_MAX_REFINEMENT_CHARS = 1000;

/** Request body for the JSON-only AI routes. The largest legitimate body
 *  is meal-plan's: up to AI_MAX_CUSTOM_FOODS custom foods plus the day's
 *  meals with full food records; typical bodies are a few KB. */
export const AI_MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

/** Largest image the vision routes accept (decoded bytes), Anthropic's
 *  documented per-image limit. */
export const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Request body for the vision routes: the base64-encoded image plus the
 *  same JSON allowance as the text routes (identify-meal also carries the
 *  custom-food catalog). */
export const AI_MAX_IMAGE_BODY_BYTES =
  4 * Math.ceil(AI_MAX_IMAGE_BYTES / 3) + AI_MAX_JSON_BODY_BYTES;
