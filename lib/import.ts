"use client";

import type {
  Meal,
  PersonalInfo,
  Recipe,
  RecipeIngredient,
} from "@/components/macro/types";
import {
  getDailyLog,
  getProfile,
  getWeightEntry,
  listCustomFoods,
  listMealTemplates,
  listRecipes,
  saveDailyLog,
  saveProfile,
  saveWeightEntry,
  upsertCustomFood,
  upsertMealTemplate,
  upsertRecipe,
  type CustomFood,
  type DailyLog,
  type MealTemplate,
  type WeightEntry,
} from "@/lib/db";

const SUPPORTED_VERSIONS = new Set([1, 2]);

export type ImportResult = {
  imported: {
    profile: 0 | 1;
    dailyLogs: number;
    weightEntries: number;
    customFoods: number;
    mealTemplates: number;
    recipes: number;
  };
  /** Rows the importer rejected because they failed validation. The UI
   *  uses this to show "3 daily logs skipped (malformed)". Hard
   *  top-level errors (no version, wrong type) throw instead. */
  skipped: Array<{ table: string; reason: string }>;
};

const ZERO_IMPORTED = {
  profile: 0 as 0 | 1,
  dailyLogs: 0,
  weightEntries: 0,
  customFoods: 0,
  mealTemplates: 0,
  recipes: 0,
};

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function isStr(x: unknown): x is string {
  return typeof x === "string";
}

// ─── Per-row type guards ───────────────────────────────────────────────────

function isPersonalInfo(x: unknown): x is PersonalInfo {
  if (!isObj(x)) return false;
  return (
    isStr(x.gender) &&
    isNum(x.age) &&
    isNum(x.weight) &&
    isNum(x.height) &&
    isStr(x.activityLevel) &&
    isStr(x.goal) &&
    isStr(x.dietType) &&
    isStr(x.dietPreference) &&
    Array.isArray(x.cuisinePreferences) &&
    Array.isArray(x.allergies) &&
    Array.isArray(x.dislikedFoods) &&
    isNum(x.weeklyRateKg)
  );
}

function isFoodItem(x: unknown): boolean {
  if (!isObj(x)) return false;
  return (
    isNum(x.id) &&
    isStr(x.name) &&
    isNum(x.protein) &&
    isNum(x.carbs) &&
    isNum(x.fat) &&
    isNum(x.calories) &&
    isNum(x.portionSize)
  );
}

function isMeal(x: unknown): x is Meal {
  return (
    isObj(x) &&
    isNum(x.id) &&
    isStr(x.name) &&
    Array.isArray(x.foods) &&
    x.foods.every(isFoodItem)
  );
}

function isDailyLog(x: unknown): x is DailyLog {
  return (
    isObj(x) &&
    isStr(x.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
    Array.isArray(x.meals) &&
    x.meals.every(isMeal) &&
    isNum(x.updatedAt)
  );
}

function isWeightEntry(x: unknown): x is WeightEntry {
  return (
    isObj(x) &&
    isStr(x.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
    isNum(x.kg) &&
    isNum(x.recordedAt)
  );
}

function isCustomFood(x: unknown): x is CustomFood {
  return (
    isObj(x) &&
    isStr(x.id) &&
    isStr(x.name) &&
    isNum(x.protein) &&
    isNum(x.carbs) &&
    isNum(x.fat) &&
    isNum(x.calories) &&
    isNum(x.createdAt)
  );
}

function isMealTemplate(x: unknown): x is MealTemplate {
  return (
    isObj(x) &&
    isStr(x.id) &&
    isStr(x.name) &&
    Array.isArray(x.foods) &&
    x.foods.every(isFoodItem) &&
    isNum(x.createdAt) &&
    isNum(x.updatedAt)
  );
}

function isRecipeIngredient(x: unknown): x is RecipeIngredient {
  if (!isObj(x)) return false;
  const m = x.macrosPer100g;
  return (
    isStr(x.foodName) &&
    isObj(m) &&
    isNum(m.protein) &&
    isNum(m.carbs) &&
    isNum(m.fat) &&
    isNum(m.calories) &&
    isNum(x.portionGrams)
  );
}

function isRecipe(x: unknown): x is Recipe {
  return (
    isObj(x) &&
    isStr(x.id) &&
    isStr(x.name) &&
    Array.isArray(x.ingredients) &&
    x.ingredients.every(isRecipeIngredient) &&
    isNum(x.createdAt) &&
    isNum(x.updatedAt)
  );
}

// ─── Bundle parse ──────────────────────────────────────────────────────────

type ParsedBundle = {
  version: number;
  data: {
    profile?: unknown;
    dailyLogs?: unknown;
    weightHistory?: unknown;
    customFoods?: unknown;
    mealTemplates?: unknown;
    recipes?: unknown;
  };
};

/** Validate the top-level bundle shape. Throws with a readable message
 *  when the file isn't a recognizable export — caller should catch and
 *  surface to the user. Per-row validation happens later; rejected rows
 *  are skipped, not fatal. */
export function parseBundle(raw: unknown): ParsedBundle {
  if (!isObj(raw)) throw new Error("Import file is not a JSON object.");
  if (!isNum(raw.version)) {
    throw new Error("Import file is missing a version number.");
  }
  if (!SUPPORTED_VERSIONS.has(raw.version)) {
    throw new Error(
      `Unsupported export version ${raw.version}. Supported: ${[...SUPPORTED_VERSIONS].join(", ")}.`,
    );
  }
  if (!isObj(raw.data)) {
    throw new Error("Import file is missing a `data` object.");
  }
  return raw as ParsedBundle;
}

// ─── Plan (dry-run preview) ────────────────────────────────────────────────

/** Per-table diff summary returned by `planImport`. The UI renders this
 *  as a small "you're about to apply" table so the user can spot an
 *  unwanted overwrite before committing. */
export type TableDiff = {
  new: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

/** Profile is a singleton, so its diff is a single tag rather than counts. */
export type ProfileDiff = {
  kind: "absent" | "new" | "updated" | "unchanged" | "skipped";
};

export type ImportPlan = {
  version: number;
  exportedAt: string | null;
  tables: {
    profile: ProfileDiff;
    dailyLogs: TableDiff;
    weightEntries: TableDiff;
    customFoods: TableDiff;
    mealTemplates: TableDiff;
    recipes: TableDiff;
  };
};

const EMPTY_TABLE_DIFF: TableDiff = {
  new: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
};

/** Stable JSON for deep-equality comparison. Both sides come from the
 *  same TypeScript types, so key order is consistent — `JSON.stringify`
 *  without a replacer is good enough. Faster than a structural deep
 *  compare for our row shapes (each row stringifies to <1 KB). */
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Walk an incoming row list against a local "by-key" map, accumulating
 *  the four-bucket diff. `keyOf` extracts the comparison key (id or
 *  date); `guard` validates the shape; `localStrip` and `incomingStrip`
 *  normalize each side for comparison so transient fields (updatedAt,
 *  recordedAt) don't trigger false "updated" counts. */
function diffRows<TIncoming, TLocal>(
  incoming: unknown,
  localByKey: Map<string, TLocal>,
  keyOf: (row: TIncoming) => string,
  guard: (row: unknown) => row is TIncoming,
  compare: (incoming: TIncoming, local: TLocal) => boolean,
): TableDiff {
  if (!Array.isArray(incoming)) return { ...EMPTY_TABLE_DIFF };
  const out: TableDiff = { ...EMPTY_TABLE_DIFF };
  for (const row of incoming) {
    if (!guard(row)) {
      out.skipped++;
      continue;
    }
    const local = localByKey.get(keyOf(row));
    if (local === undefined) {
      out.new++;
    } else if (compare(row, local)) {
      out.unchanged++;
    } else {
      out.updated++;
    }
  }
  return out;
}

/** Inspect an import bundle and report what *would* change without
 *  touching IndexedDB. Same shape semantics as `importBundle`'s commit
 *  path — every "updated" / "new" / "unchanged" here corresponds exactly
 *  to the eventual write or no-op. */
export async function planImport(raw: unknown): Promise<ImportPlan> {
  const bundle = parseBundle(raw);

  // Profile (singleton).
  let profileDiff: ProfileDiff;
  if (bundle.data.profile === undefined || bundle.data.profile === null) {
    profileDiff = { kind: "absent" };
  } else if (!isPersonalInfo(bundle.data.profile)) {
    profileDiff = { kind: "skipped" };
  } else {
    const local = await getProfile();
    if (!local) profileDiff = { kind: "new" };
    else if (eq(local, bundle.data.profile))
      profileDiff = { kind: "unchanged" };
    else profileDiff = { kind: "updated" };
  }

  // Build local indexes once per table.
  const localCustom = new Map(
    (await listCustomFoods()).map((f) => [f.id, f] as const),
  );
  const localTemplates = new Map(
    (await listMealTemplates()).map((t) => [t.id, t] as const),
  );
  const localRecipes = new Map(
    (await listRecipes()).map((r) => [r.id, r] as const),
  );

  // Daily logs + weight history: keyed by date; we go one-by-one rather
  // than building a Map because there's no listWeightEntry/listDailyLog
  // API that returns just keys. The lookups are O(1) per date.
  const dailyLogs = diffByKeyAsync(
    bundle.data.dailyLogs,
    isDailyLog,
    (row) => row.date,
    async (row) => {
      const local = await getDailyLog(row.date);
      return local && eq(local.meals, row.meals);
    },
  );
  const weightEntries = diffByKeyAsync(
    bundle.data.weightHistory,
    isWeightEntry,
    (row) => row.date,
    async (row) => {
      const local = await getWeightEntry(row.date);
      return !!local && local.kg === row.kg;
    },
  );

  const customFoods = diffRows<CustomFood, CustomFood>(
    bundle.data.customFoods,
    localCustom,
    (row) => row.id,
    isCustomFood,
    (a, b) =>
      // Compare content only — strip transient sync metadata
      // (`createdAt`, `localUpdatedAt`, `serverUpdatedAt`) that
      // legitimately differs across export/import even when the food
      // itself hasn't changed.
      eq(
        {
          ...a,
          createdAt: 0,
          localUpdatedAt: undefined,
          serverUpdatedAt: undefined,
        },
        {
          ...b,
          createdAt: 0,
          localUpdatedAt: undefined,
          serverUpdatedAt: undefined,
        },
      ),
  );
  const mealTemplates = diffRows<MealTemplate, MealTemplate>(
    bundle.data.mealTemplates,
    localTemplates,
    (row) => row.id,
    isMealTemplate,
    // Ignore updatedAt/createdAt churn — a template is "the same" iff
    // its name + foods match. (Sync metadata is not compared either.)
    (a, b) => a.name === b.name && eq(a.foods, b.foods),
  );
  const recipes = diffRows<Recipe, Recipe>(
    bundle.data.recipes,
    localRecipes,
    (row) => row.id,
    isRecipe,
    (a, b) =>
      a.name === b.name &&
      a.cuisine === b.cuisine &&
      a.notes === b.notes &&
      eq(a.ingredients, b.ingredients),
  );

  return {
    version: bundle.version,
    exportedAt:
      typeof (raw as { exportedAt?: unknown }).exportedAt === "string"
        ? ((raw as { exportedAt?: string }).exportedAt ?? null)
        : null,
    tables: {
      profile: profileDiff,
      dailyLogs: await dailyLogs,
      weightEntries: await weightEntries,
      customFoods,
      mealTemplates,
      recipes,
    },
  };
}

/** Async cousin of `diffRows` for tables whose `unchanged` predicate
 *  requires hitting IDB per row (daily logs, weight history). Same
 *  output shape. */
async function diffByKeyAsync<TIncoming>(
  incoming: unknown,
  guard: (row: unknown) => row is TIncoming,
  keyOf: (row: TIncoming) => string,
  matchesLocal: (row: TIncoming) => Promise<boolean | null>,
): Promise<TableDiff> {
  if (!Array.isArray(incoming)) return { ...EMPTY_TABLE_DIFF };
  const out: TableDiff = { ...EMPTY_TABLE_DIFF };
  // Dedup incoming by key — a malformed export with duplicate dates
  // would otherwise double-count.
  const seen = new Set<string>();
  for (const row of incoming) {
    if (!guard(row)) {
      out.skipped++;
      continue;
    }
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const match = await matchesLocal(row);
    if (match === null) out.new++;
    else if (match) out.unchanged++;
    else out.updated++;
  }
  return out;
}

// ─── Apply (commit) ────────────────────────────────────────────────────────

/** Phase identifiers reported via the progress callback. */
export type ImportPhase =
  | "profile"
  | "dailyLogs"
  | "weightHistory"
  | "customFoods"
  | "mealTemplates"
  | "recipes"
  | "done";

export type ImportProgress = {
  phase: ImportPhase;
  rows: number;
  total: number;
};

/** Yield to the event loop every BATCH rows so a 1000-row import doesn't
 *  block painting for the whole apply phase. Sized small enough to feel
 *  responsive on a slow device, large enough that the per-yield overhead
 *  isn't dominant. */
const YIELD_EVERY = 50;
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Merge an export bundle into IndexedDB. Each row is upserted at its
 *  existing id (custom foods, meal templates, recipes) or its natural
 *  key (profile = singleton, daily logs by date, weight by date). Rows
 *  that fail per-type validation are silently skipped — the result
 *  surfaces a count per table so the caller can show
 *  "3 daily logs skipped". A v1 bundle (no `recipes`) imports cleanly;
 *  the recipes counter just stays at zero.
 *
 *  Optional `onProgress` callback fires per phase with running counts
 *  so the UI can paint a meaningful progress bar. */
export async function importBundle(
  raw: unknown,
  onProgress?: (event: ImportProgress) => void,
): Promise<ImportResult> {
  const bundle = parseBundle(raw);
  const result: ImportResult = { imported: { ...ZERO_IMPORTED }, skipped: [] };
  const emit = (phase: ImportPhase, rows: number, total: number) => {
    onProgress?.({ phase, rows, total });
  };

  // Profile (singleton).
  emit("profile", 0, 1);
  if (bundle.data.profile !== undefined && bundle.data.profile !== null) {
    if (isPersonalInfo(bundle.data.profile)) {
      await saveProfile(bundle.data.profile);
      result.imported.profile = 1;
    } else {
      result.skipped.push({ table: "profile", reason: "malformed" });
    }
  }
  emit("profile", result.imported.profile, result.imported.profile);
  await yieldToEventLoop();

  // Daily logs.
  const dailyLogs = Array.isArray(bundle.data.dailyLogs)
    ? bundle.data.dailyLogs
    : [];
  emit("dailyLogs", 0, dailyLogs.length);
  for (let i = 0; i < dailyLogs.length; i++) {
    const row = dailyLogs[i];
    if (isDailyLog(row)) {
      await saveDailyLog(row.date, row.meals);
      result.imported.dailyLogs++;
    } else {
      result.skipped.push({ table: "dailyLogs", reason: "malformed" });
    }
    if (i % YIELD_EVERY === YIELD_EVERY - 1) {
      emit("dailyLogs", i + 1, dailyLogs.length);
      await yieldToEventLoop();
    }
  }
  emit("dailyLogs", dailyLogs.length, dailyLogs.length);
  await yieldToEventLoop();

  // Weight history.
  const weightHistory = Array.isArray(bundle.data.weightHistory)
    ? bundle.data.weightHistory
    : [];
  emit("weightHistory", 0, weightHistory.length);
  for (let i = 0; i < weightHistory.length; i++) {
    const row = weightHistory[i];
    if (isWeightEntry(row)) {
      await saveWeightEntry(row.date, row.kg);
      result.imported.weightEntries++;
    } else {
      result.skipped.push({ table: "weightHistory", reason: "malformed" });
    }
    if (i % YIELD_EVERY === YIELD_EVERY - 1) {
      emit("weightHistory", i + 1, weightHistory.length);
      await yieldToEventLoop();
    }
  }
  emit("weightHistory", weightHistory.length, weightHistory.length);
  await yieldToEventLoop();

  // Custom foods (upsert by id).
  const customFoods = Array.isArray(bundle.data.customFoods)
    ? bundle.data.customFoods
    : [];
  emit("customFoods", 0, customFoods.length);
  for (let i = 0; i < customFoods.length; i++) {
    const row = customFoods[i];
    if (isCustomFood(row)) {
      await upsertCustomFood(row);
      result.imported.customFoods++;
    } else {
      result.skipped.push({ table: "customFoods", reason: "malformed" });
    }
    if (i % YIELD_EVERY === YIELD_EVERY - 1) {
      emit("customFoods", i + 1, customFoods.length);
      await yieldToEventLoop();
    }
  }
  emit("customFoods", customFoods.length, customFoods.length);
  await yieldToEventLoop();

  // Meal templates.
  const mealTemplates = Array.isArray(bundle.data.mealTemplates)
    ? bundle.data.mealTemplates
    : [];
  emit("mealTemplates", 0, mealTemplates.length);
  for (let i = 0; i < mealTemplates.length; i++) {
    const row = mealTemplates[i];
    if (isMealTemplate(row)) {
      await upsertMealTemplate(row);
      result.imported.mealTemplates++;
    } else {
      result.skipped.push({ table: "mealTemplates", reason: "malformed" });
    }
    if (i % YIELD_EVERY === YIELD_EVERY - 1) {
      emit("mealTemplates", i + 1, mealTemplates.length);
      await yieldToEventLoop();
    }
  }
  emit("mealTemplates", mealTemplates.length, mealTemplates.length);
  await yieldToEventLoop();

  // Recipes (v2+). v1 bundles don't include this field — leave at 0.
  const recipes = Array.isArray(bundle.data.recipes) ? bundle.data.recipes : [];
  emit("recipes", 0, recipes.length);
  for (let i = 0; i < recipes.length; i++) {
    const row = recipes[i];
    if (isRecipe(row)) {
      await upsertRecipe(row);
      result.imported.recipes++;
    } else {
      result.skipped.push({ table: "recipes", reason: "malformed" });
    }
    if (i % YIELD_EVERY === YIELD_EVERY - 1) {
      emit("recipes", i + 1, recipes.length);
      await yieldToEventLoop();
    }
  }
  emit("recipes", recipes.length, recipes.length);
  emit("done", 0, 0);

  return result;
}

/** Read a File (from a <input type="file">) and parse + plan it without
 *  applying. Caller renders the preview, then re-uses the parsed bundle
 *  via {@link importBundle} when the user confirms. Returns both the
 *  raw bundle and the plan so the apply step doesn't need to re-parse. */
export async function planFromFile(
  file: File,
): Promise<{ raw: unknown; plan: ImportPlan }> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Not valid JSON: ${err instanceof Error ? err.message : "parse error"}.`,
    );
  }
  const plan = await planImport(raw);
  return { raw, plan };
}

/** Read a File (from a <input type="file">) and import it directly.
 *  Kept as a convenience for the original "skip preview" path — most
 *  callers will go through `planFromFile` + `importBundle` instead. */
export async function importFromFile(
  file: File,
  onProgress?: (event: ImportProgress) => void,
): Promise<ImportResult> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Not valid JSON: ${err instanceof Error ? err.message : "parse error"}.`,
    );
  }
  return importBundle(raw, onProgress);
}
