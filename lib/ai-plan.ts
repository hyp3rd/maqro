"use client";

import type { DietPreference, Food, Meal } from "@/components/macro/types";
import type { CoherenceIssue } from "@/lib/ai/plan-coherence";
import {
  AI_MAX_CUSTOM_FOODS,
  AI_MAX_FOODS_PER_MEAL,
  AI_MAX_REFINEMENT_CHARS,
} from "@/lib/ai/request-limits";
import {
  clampAiFoodLabels,
  clampAiText,
  toAiPantryBias,
  toAiPreferenceTags,
  toAiRecentlyEaten,
} from "@/lib/ai/request-payload";
import { clientFetch } from "@/lib/auth/client-fetch";
import type { MarketCode } from "@/lib/markets";
import { formatClock } from "@/lib/today/timeline";
import { sessionLabel } from "@/lib/training-labels";
import type { WorkoutMealRole } from "@maqro/core/types";
import {
  type MacroAims,
  type WorkoutMealsPlan,
  workoutRole,
} from "@maqro/core/workout-meals";

export type AiPlanRequest = {
  targets: { protein: number; carbs: number; fat: number; calories: number };
  dietPreference: DietPreference;
  mealNames: string[];
  customFoods: Food[];
  /** Cuisines the user enjoys. Empty = no preference. */
  cuisinePreferences: string[];
  /** Hard-filter list of allergens / foods to avoid. */
  allergies: string[];
  /** Soft signal - foods the user dislikes but isn't allergic to. The AI
   * is asked to avoid them when it can. Not enforced server-side. */
  dislikedFoods: string[];
  /** Optional: free-text refinement to apply to a previously-generated
   *  plan (sourced from a refiner pill like "lower sugars"). Requires
   *  `previousMeals` to also be set so the AI has a starting plan to
   *  adjust. */
  refinement?: string;
  /** Optional: the meal plan the user wants adjusted. Required when
   *  `refinement` is set or when `targetMealName` is set. */
  previousMeals?: Meal[];
  /** Optional: regenerate only this meal slot, leaving the rest
   *  unchanged. The AI returns just one meal; the caller replaces
   *  the matching slot in the existing plan. Requires `previousMeals`
   *  so the AI sees the day's context. */
  targetMealName?: string;
  /** Optional: foods the user has eaten in their recent daily-log
   *  history. Used by the route as a soft bias so generated plans
   *  look like the user's actual rotation. Compute via
   *  [lib/personalization/preferences.ts](./personalization/preferences.ts). */
  recentlyEatenFoods?: { name: string; count: number }[];
  /** Optional: pantry items the user has on hand. Used by the route
   *  as a soft bias so generated plans prefer ingredients the user
   *  already has. Compute via `listPantryItems()` in
   *  [lib/db.ts](./db.ts). */
  pantryItems?: { name: string; quantity: number; unit: string }[];
  /** Optional: the active shopping market — biases the AI's Open Food Facts
   *  lookups toward that country (matches the manual food search). */
  market?: MarketCode;
  /** Optional: a training day's workout meals among `mealNames`, each with
   *  its own aims and eating window (`aiWorkoutContext`). */
  workoutMeals?: {
    name: string;
    role: WorkoutMealRole;
    aims: MacroAims;
    window?: string;
  }[];
  /** Optional: the day's session as the app names it, for their context. */
  session?: string;
};

/** The workout-meal part of a plan request for `meals` (the day as shown):
 *  each workout meal the day plans, by the name it has there, with its aims
 *  and eating window, and the session. Empty on a day without them. */
export function aiWorkoutContext(
  meals: readonly Meal[],
  plan: WorkoutMealsPlan | null,
): Pick<AiPlanRequest, "workoutMeals" | "session"> {
  if (!plan) return {};
  const workoutMeals = [plan.pre, plan.post].flatMap((slot) => {
    const meal = slot && meals.find((m) => workoutRole(m) === slot.role);
    if (!slot || !meal) return [];
    return [
      {
        name: meal.name,
        role: slot.role,
        aims: slot.aims,
        ...(slot.window && {
          window: `${formatClock(slot.window.start)}–${formatClock(slot.window.end)}`,
        }),
      },
    ];
  });
  if (workoutMeals.length === 0) return {};
  return { workoutMeals, session: sessionLabel(plan.session) };
}

/** Result of asking the AI for a meal plan. `kind: "ok"` always carries
 * a usable `meals` array; everything else carries enough info for the
 * caller to surface a useful message before falling back to the
 * deterministic planner.
 *
 * `coherenceIssues` is populated only when the server's validator
 * caught problems the AI couldn't self-correct within the iteration
 * budget - the caller should surface them to the user (which meal
 * violates which rule) so they know to click a refiner pill or
 * regenerate the offending slot. Absent / empty = clean plan. */
export type AiPlanResult =
  | { kind: "ok"; meals: Meal[]; coherenceIssues?: CoherenceIssue[] }
  | { kind: "not-configured" } // 503 - env or auth gate missing
  | { kind: "not-authenticated" } // 401 - guest user
  | { kind: "rate-limited" } // 429
  | { kind: "cap-reached"; used: number; cap: number } // 402 - free-tier cap hit
  | { kind: "error"; message: string };

/** The request as /api/meal-plan accepts it: the user's stored data fitted
 * to the route's size limits (lib/ai/request-limits.ts) so a large
 * library or a long food name never turns into a 400. Lists are clamped
 * (callers pass custom foods newest-first, `listCustomFoods` order, so the
 * newest survive; the route only renders the first 30 bias items anyway)
 * and strings that come from unbounded stored data are truncated
 * (lib/ai/request-payload.ts). Meal-slot names are app-defined and sent
 * as-is: the caller matches the returned meal to its slot by name. */
export function toAiPlanPayload(req: AiPlanRequest): AiPlanRequest {
  return {
    ...req,
    customFoods: req.customFoods
      .slice(0, AI_MAX_CUSTOM_FOODS)
      .map(clampAiFoodLabels),
    cuisinePreferences: toAiPreferenceTags(req.cuisinePreferences),
    allergies: toAiPreferenceTags(req.allergies),
    dislikedFoods: toAiPreferenceTags(req.dislikedFoods),
    // A coherence-issue refinement embeds food names, which can be long.
    refinement:
      req.refinement === undefined
        ? undefined
        : clampAiText(req.refinement, AI_MAX_REFINEMENT_CHARS),
    previousMeals: req.previousMeals?.map((m) => ({
      ...m,
      foods: m.foods.slice(0, AI_MAX_FOODS_PER_MEAL).map(clampAiFoodLabels),
    })),
    recentlyEatenFoods:
      req.recentlyEatenFoods && toAiRecentlyEaten(req.recentlyEatenFoods),
    pantryItems: req.pantryItems && toAiPantryBias(req.pantryItems),
  };
}

/** POST to /api/meal-plan. Network and non-2xx responses are mapped to
 * discriminated `AiPlanResult` kinds so callers can match instead of
 * branching on HTTP status codes. The body is `toAiPlanPayload(req)`. */
export async function requestAiMealPlan(
  req: AiPlanRequest,
): Promise<AiPlanResult> {
  const payload = toAiPlanPayload(req);
  let res: Response;
  try {
    res = await clientFetch("/api/meal-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as {
        meals: Meal[];
        coherenceIssues?: CoherenceIssue[];
      };
      if (!Array.isArray(data.meals)) {
        return { kind: "error", message: "Malformed AI response." };
      }
      return Array.isArray(data.coherenceIssues) &&
        data.coherenceIssues.length > 0
        ? {
            kind: "ok",
            meals: data.meals,
            coherenceIssues: data.coherenceIssues,
          }
        : { kind: "ok", meals: data.meals };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "Malformed AI response.",
      };
    }
  }

  if (res.status === 401) return { kind: "not-authenticated" };
  if (res.status === 503) return { kind: "not-configured" };
  if (res.status === 429) return { kind: "rate-limited" };
  if (res.status === 402) {
    // Cap reached - the route includes used + cap so the client can
    // surface a specific "N of M used" message rather than a generic
    // "AI failed".
    const body = (await res.json().catch(() => ({}))) as {
      used?: number;
      cap?: number;
    };
    return {
      kind: "cap-reached",
      used: typeof body.used === "number" ? body.used : 0,
      cap: typeof body.cap === "number" ? body.cap : 0,
    };
  }

  // Any other non-2xx - pull a server-provided message if available.
  const body = (await res.json().catch(() => ({}) as { error?: string })) as {
    error?: string;
  };
  return { kind: "error", message: body.error ?? `HTTP ${res.status}` };
}
