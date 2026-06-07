"use client";

import { clientFetch } from "@/lib/auth/client-fetch";

export type SuggestDayRecipe = {
  id: string;
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  cuisine?: string;
  diet?: string;
};

export type SuggestDayRequest = {
  /** Macros still to fill for the rest of today (target − already logged). */
  targets: { protein: number; carbs: number; fat: number; calories: number };
  /** The user's meal-slot names, in order. */
  mealSlots: string[];
  /** The user's saved recipes, reduced to per-serving macros + labels. */
  recipes: SuggestDayRecipe[];
};

export type DayAssignment = { slot: string; recipeId: string };

export type SuggestDayResult =
  | { kind: "ok"; assignments: DayAssignment[]; note: string | null }
  | { kind: "not-authenticated" }
  | { kind: "not-configured" }
  | { kind: "rate-limited" }
  | { kind: "cap-reached"; used: number; cap: number }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/** POST the saved recipes + remaining targets to `/api/suggest-day` and get
 *  back one recipe per meal slot. Mirrors `requestAiMealPlan`'s status-to-kind
 *  mapping so callers handle the cap/auth/config cases the same way. */
export async function requestDaySuggestion(
  req: SuggestDayRequest,
): Promise<SuggestDayResult> {
  let res: Response;
  try {
    res = await clientFetch("/api/suggest-day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
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
        assignments?: DayAssignment[];
        note?: string | null;
      };
      if (!Array.isArray(data.assignments) || data.assignments.length === 0) {
        return { kind: "empty" };
      }
      return {
        kind: "ok",
        assignments: data.assignments,
        note: data.note ?? null,
      };
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
  if (res.status === 422) return { kind: "empty" };
  if (res.status === 402) {
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
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { kind: "error", message: body.error ?? `HTTP ${res.status}` };
}
