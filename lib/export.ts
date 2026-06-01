"use client";

import type { PersonalInfo, Recipe } from "@/components/macro/types";
import {
  getProfile,
  listCustomFoods,
  listDailyLogs,
  listMealTemplates,
  listRecipes,
  listWeightEntries,
  type CustomFood,
  type DailyLog,
  type MealTemplate,
  type WeightEntry,
} from "@/lib/db";

/** Bumped whenever the export shape changes in a way an importer would
 * need to know about (added/removed stores, renamed fields, semantic
 * changes).
 *
 *  - v1: profile, dailyLogs, weightHistory, customFoods, mealTemplates.
 *  - v2: adds `recipes`. Old v1 bundles import fine (recipes treated as
 *        absent). */
export const EXPORT_VERSION = 2;

export type ExportBundle = {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  user: { id: string; email: string | null } | null;
  data: {
    profile: PersonalInfo | null;
    dailyLogs: DailyLog[];
    weightHistory: WeightEntry[];
    customFoods: CustomFood[];
    mealTemplates: MealTemplate[];
    recipes: Recipe[];
  };
};

/** Phase identifiers reported via the progress callback. The order in
 *  this union also matches the read order — the UI can show "step 3 of 6"
 *  by mapping the phase to an index. */
export type ExportPhase =
  | "profile"
  | "dailyLogs"
  | "weightHistory"
  | "customFoods"
  | "mealTemplates"
  | "recipes"
  | "done";

export type ExportProgress = {
  phase: ExportPhase;
  /** Per-phase rows read so far. For singletons (profile) this is 0 or 1. */
  rows: number;
  /** The phase's known total (== rows for completed phases). */
  total: number;
};

const EXPORT_PHASES: readonly Exclude<ExportPhase, "done">[] = [
  "profile",
  "dailyLogs",
  "weightHistory",
  "customFoods",
  "mealTemplates",
  "recipes",
];

/** Map the `phase` to a step index (0–5) and total (6). Convenience for
 *  UI progress bars that want a single percentage. */
export function exportPhaseIndex(phase: ExportPhase): {
  step: number;
  total: number;
} {
  const idx = EXPORT_PHASES.indexOf(phase as Exclude<ExportPhase, "done">);
  return {
    step: idx === -1 ? EXPORT_PHASES.length : idx,
    total: EXPORT_PHASES.length,
  };
}

/** Yield to the event loop so the browser can paint between phases.
 *  `setTimeout(0)` is the universal way to get a macrotask break across
 *  browsers; for IDB-light data this adds only a few ms. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Reads everything in IndexedDB and returns a JSON-serializable bundle.
 *  Pure: doesn't touch the network and doesn't trigger a download — the
 *  caller decides what to do with the bundle.
 *
 *  Each store is read sequentially with a yield after each read so the
 *  optional `onProgress` callback can paint a meaningful progress bar.
 *  The yield adds a couple of ms vs the previous `Promise.all` shape,
 *  but for export sizes seen in practice (well under 1 MB) the
 *  difference is invisible — and the UX of "exporting daily logs… now
 *  meal templates…" is far better than a frozen tab for the rare large
 *  bundle. */
export async function buildExport(
  user: { id: string; email: string | null } | null,
  onProgress?: (event: ExportProgress) => void,
): Promise<ExportBundle> {
  const emit = (phase: ExportPhase, rows: number, total: number) => {
    onProgress?.({ phase, rows, total });
  };

  emit("profile", 0, 1);
  const profile = await getProfile();
  emit("profile", profile ? 1 : 0, profile ? 1 : 0);
  await yieldToEventLoop();

  emit("dailyLogs", 0, 0);
  const dailyLogs = await listDailyLogs();
  emit("dailyLogs", dailyLogs.length, dailyLogs.length);
  await yieldToEventLoop();

  emit("weightHistory", 0, 0);
  const weightHistory = await listWeightEntries();
  emit("weightHistory", weightHistory.length, weightHistory.length);
  await yieldToEventLoop();

  emit("customFoods", 0, 0);
  const customFoods = await listCustomFoods();
  emit("customFoods", customFoods.length, customFoods.length);
  await yieldToEventLoop();

  emit("mealTemplates", 0, 0);
  const mealTemplates = await listMealTemplates();
  emit("mealTemplates", mealTemplates.length, mealTemplates.length);
  await yieldToEventLoop();

  emit("recipes", 0, 0);
  const recipes = await listRecipes();
  emit("recipes", recipes.length, recipes.length);

  const bundle: ExportBundle = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    user,
    data: {
      profile,
      dailyLogs,
      weightHistory,
      customFoods,
      mealTemplates,
      recipes,
    },
  };
  emit("done", 0, 0);
  return bundle;
}

/** Triggers a browser download of the given bundle. Filename includes the
 * date so successive exports don't clobber each other in the user's
 * Downloads folder. */
export function downloadExport(bundle: ExportBundle): void {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `macro-calculator-export-${bundle.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free the object URL on the next tick so the click handler has time
  // to start the download in browsers that defer the navigation.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
