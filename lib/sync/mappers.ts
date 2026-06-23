/** Pure shape conversion between the local IDB types and the Supabase row
 * shapes. The local types use camelCase + epoch ms; Postgres uses
 * snake_case + ISO timestamps. We keep these as plain functions so they
 * can be unit-tested without spinning up Supabase. */
import type {
  Food,
  FoodKind,
  MacroBreakdown,
  Meal,
  PersonalInfo,
  Recipe,
} from "@/components/macro/types";
import type {
  BloodPressure,
  BodyMeasurement,
  CustomFood,
  DailyLog,
  FastSession,
  FavoriteFood,
  FavoriteStore,
  MealSchedule,
  MealTemplate,
  PantryItem,
  PantryNotification,
  Supplement,
  SupplementIntake,
  SupplementIntakeEntry,
  SupplementSchedule,
  WaterIntake,
  WeightEntry,
} from "@/lib/db";
import type { FastingProtocol } from "@/lib/fasting";
import type {
  MicronutrientProfile,
  MicronutrientValues,
} from "@/lib/micronutrients/types";

// ─── Profile ───────────────────────────────────────────────────────────────

export type ProfileRow = {
  user_id: string;
  payload: PersonalInfo;
  updated_at: string;
};

export function profileToRow(
  userId: string,
  profile: PersonalInfo,
): Pick<ProfileRow, "user_id" | "payload"> {
  return { user_id: userId, payload: profile };
}

export function profileFromRow(row: ProfileRow): PersonalInfo {
  return row.payload;
}

// ─── Daily logs ────────────────────────────────────────────────────────────

export type DailyLogRow = {
  user_id: string;
  date: string;
  meals: Meal[];
  updated_at: string;
};

export function dailyLogToRow(
  userId: string,
  log: DailyLog,
): Pick<DailyLogRow, "user_id" | "date" | "meals"> {
  return { user_id: userId, date: log.date, meals: log.meals };
}

export function dailyLogFromRow(row: DailyLogRow): DailyLog {
  return {
    date: row.date,
    meals: row.meals,
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Weight history ────────────────────────────────────────────────────────

export type WeightRow = {
  user_id: string;
  date: string;
  kg: number;
  recorded_at: string;
  updated_at: string;
};

export function weightToRow(
  userId: string,
  entry: WeightEntry,
): Pick<WeightRow, "user_id" | "date" | "kg" | "recorded_at"> {
  return {
    user_id: userId,
    date: entry.date,
    kg: entry.kg,
    recorded_at: new Date(entry.recordedAt).toISOString(),
  };
}

export function weightFromRow(row: WeightRow): WeightEntry {
  return {
    date: row.date,
    kg: row.kg,
    recordedAt: Date.parse(row.recorded_at),
  };
}

// ─── Water intake ──────────────────────────────────────────────────────────

export type WaterRow = {
  user_id: string;
  date: string;
  ml: number;
  recorded_at: string;
  updated_at: string;
};

export function waterToRow(
  userId: string,
  entry: WaterIntake,
): Pick<WaterRow, "user_id" | "date" | "ml" | "recorded_at"> {
  return {
    user_id: userId,
    date: entry.date,
    ml: entry.ml,
    recorded_at: new Date(entry.recordedAt).toISOString(),
  };
}

export function waterFromRow(row: WaterRow): WaterIntake {
  return {
    date: row.date,
    ml: row.ml,
    recordedAt: Date.parse(row.recorded_at),
  };
}

// ─── Supplement intake ─────────────────────────────────────────────────────

export type SupplementIntakeRow = {
  user_id: string;
  date: string;
  taken: SupplementIntakeEntry[];
  recorded_at: string;
  updated_at: string;
};

export function supplementIntakeToRow(
  userId: string,
  entry: SupplementIntake,
): Pick<SupplementIntakeRow, "user_id" | "date" | "taken" | "recorded_at"> {
  return {
    user_id: userId,
    date: entry.date,
    taken: entry.taken,
    recorded_at: new Date(entry.recordedAt).toISOString(),
  };
}

export function supplementIntakeFromRow(
  row: SupplementIntakeRow,
): SupplementIntake {
  return {
    date: row.date,
    taken: row.taken,
    recordedAt: Date.parse(row.recorded_at),
  };
}

// ─── Body measurements ─────────────────────────────────────────────────────

export type BodyMeasurementRow = {
  user_id: string;
  date: string;
  /** All three circumferences are nullable in the schema — the user
   *  can log just what they measured today. The body-fat estimator
   *  skips rows missing required inputs. */
  waist_cm: number | null;
  neck_cm: number | null;
  hips_cm: number | null;
  notes: string | null;
  recorded_at: string;
  updated_at: string;
};

export function bodyMeasurementToRow(
  userId: string,
  entry: BodyMeasurement,
): Pick<
  BodyMeasurementRow,
  | "user_id"
  | "date"
  | "waist_cm"
  | "neck_cm"
  | "hips_cm"
  | "notes"
  | "recorded_at"
> {
  // Optional client fields collapse to null on the wire. The
  // schema's CHECK constraint on the cm columns rejects 0 / negative,
  // so we don't have to defensively filter here — bad values would
  // never have made it into IDB through `saveBodyMeasurement`.
  return {
    user_id: userId,
    date: entry.date,
    waist_cm: entry.waistCm ?? null,
    neck_cm: entry.neckCm ?? null,
    hips_cm: entry.hipsCm ?? null,
    notes: entry.notes ?? null,
    recorded_at: new Date(entry.recordedAt).toISOString(),
  };
}

export function bodyMeasurementFromRow(
  row: BodyMeasurementRow,
): BodyMeasurement {
  return {
    date: row.date,
    waistCm: row.waist_cm ?? undefined,
    neckCm: row.neck_cm ?? undefined,
    hipsCm: row.hips_cm ?? undefined,
    notes: row.notes ?? undefined,
    recordedAt: Date.parse(row.recorded_at),
  };
}

// ─── Blood pressure ────────────────────────────────────────────────────────

export type BloodPressureRow = {
  user_id: string;
  date: string;
  /** Both pressures are required (a reading needs the pair). */
  systolic: number;
  diastolic: number;
  /** Pulse + notes are optional — nullable on the wire. */
  pulse: number | null;
  notes: string | null;
  recorded_at: string;
  updated_at: string;
};

export function bloodPressureToRow(
  userId: string,
  entry: BloodPressure,
): Pick<
  BloodPressureRow,
  | "user_id"
  | "date"
  | "systolic"
  | "diastolic"
  | "pulse"
  | "notes"
  | "recorded_at"
> {
  return {
    user_id: userId,
    date: entry.date,
    systolic: entry.systolic,
    diastolic: entry.diastolic,
    pulse: entry.pulse ?? null,
    notes: entry.notes ?? null,
    recorded_at: new Date(entry.recordedAt).toISOString(),
  };
}

export function bloodPressureFromRow(row: BloodPressureRow): BloodPressure {
  return {
    date: row.date,
    systolic: row.systolic,
    diastolic: row.diastolic,
    pulse: row.pulse ?? undefined,
    notes: row.notes ?? undefined,
    recordedAt: Date.parse(row.recorded_at),
  };
}

// ─── Fast sessions ───────────────────────────────────────────────────────────

export type FastSessionRow = {
  user_id: string;
  id: string;
  /** Epoch-ms instants serialized as ISO on the wire (Postgres timestamptz). */
  started_at: string;
  ended_at: string;
  protocol: FastingProtocol;
  target_hours: number;
  updated_at: string;
};

export function fastSessionToRow(
  userId: string,
  entry: FastSession,
): Pick<
  FastSessionRow,
  "user_id" | "id" | "started_at" | "ended_at" | "protocol" | "target_hours"
> {
  return {
    user_id: userId,
    id: entry.id,
    started_at: new Date(entry.startedAt).toISOString(),
    ended_at: new Date(entry.endedAt).toISOString(),
    protocol: entry.protocol,
    target_hours: entry.targetHours,
  };
}

export function fastSessionFromRow(row: FastSessionRow): FastSession {
  return {
    id: row.id,
    startedAt: Date.parse(row.started_at),
    endedAt: Date.parse(row.ended_at),
    protocol: row.protocol,
    targetHours: row.target_hours,
  };
}

// ─── Custom foods ──────────────────────────────────────────────────────────

export type CustomFoodRow = {
  id: string;
  user_id: string;
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  /** Nullable until the user classifies; client treats null as omnivore-only. */
  diet_kind: string | null;
  /** Manual drag-and-drop position. Optional + nullable because pre-v7
   *  rows from the server don't have the column, and rows the user
   *  hasn't dragged yet leave it null (the client falls back to
   *  createdAt order). */
  sort_order?: number | null;
  /** Macro-breakdown (sugars / fiber / fat-subtypes). All optional +
   *  nullable per the migration — pre-0008 rows don't have them; we
   *  treat undefined/null as "unknown" for display purposes. */
  sugars?: number | null;
  added_sugars?: number | null;
  fiber?: number | null;
  saturated_fat?: number | null;
  trans_fat?: number | null;
  mono_fat?: number | null;
  poly_fat?: number | null;
  /** Per-100g micronutrients as a JSONB map (nutrient key → value in
   *  canonical unit). Optional + nullable — only OFF-imported custom
   *  foods carry it; older rows and hand-entered foods leave it null.
   *  Single column rather than ten so the schema stays flat. */
  micronutrients?: MicronutrientValues | null;
  created_at: string;
  updated_at: string;
};

/** The set of strings stored in `diet_kind`. Mirrors the FoodKind union;
 * keeping it here as a Set lets us validate values read back from Supabase
 * (e.g. a hand-edit in the dashboard) without trusting the row blindly. */
const FOOD_KIND_VALUES = new Set<FoodKind>([
  "land-meat",
  "seafood",
  "egg",
  "dairy",
  "honey",
  "plant",
]);

function parseDietKind(value: string | null): FoodKind | undefined {
  if (value && FOOD_KIND_VALUES.has(value as FoodKind))
    return value as FoodKind;
  return undefined;
}

export function customFoodToRow(
  userId: string,
  food: CustomFood,
): Omit<CustomFoodRow, "updated_at"> {
  return {
    id: food.id,
    user_id: userId,
    name: food.name,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    calories: food.calories,
    brand: food.brand ?? null,
    category: food.category ?? null,
    sub_category: food.subCategory ?? null,
    diet_kind: food.dietKind ?? null,
    sort_order: food.sortOrder ?? null,
    sugars: food.sugars ?? null,
    added_sugars: food.addedSugars ?? null,
    fiber: food.fiber ?? null,
    saturated_fat: food.saturatedFat ?? null,
    trans_fat: food.transFat ?? null,
    mono_fat: food.monoFat ?? null,
    poly_fat: food.polyFat ?? null,
    micronutrients: food.micronutrients ?? null,
    created_at: new Date(food.createdAt).toISOString(),
  };
}

export function customFoodFromRow(row: CustomFoodRow): CustomFood {
  return {
    id: row.id,
    name: row.name,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    calories: row.calories,
    brand: row.brand ?? undefined,
    category: row.category ?? undefined,
    subCategory: row.sub_category ?? undefined,
    dietKind: parseDietKind(row.diet_kind),
    sortOrder: row.sort_order ?? undefined,
    sugars: row.sugars ?? undefined,
    addedSugars: row.added_sugars ?? undefined,
    fiber: row.fiber ?? undefined,
    saturatedFat: row.saturated_fat ?? undefined,
    transFat: row.trans_fat ?? undefined,
    monoFat: row.mono_fat ?? undefined,
    polyFat: row.poly_fat ?? undefined,
    micronutrients: row.micronutrients ?? undefined,
    createdAt: Date.parse(row.created_at),
  };
}

// ─── Meal templates ────────────────────────────────────────────────────────

export type MealTemplateRow = {
  id: string;
  user_id: string;
  name: string;
  foods: MealTemplate["foods"];
  sort_order?: number | null;
  created_at: string;
  updated_at: string;
};

export function mealTemplateToRow(
  userId: string,
  template: MealTemplate,
): Omit<MealTemplateRow, "updated_at"> {
  return {
    id: template.id,
    user_id: userId,
    name: template.name,
    foods: template.foods,
    sort_order: template.sortOrder ?? null,
    created_at: new Date(template.createdAt).toISOString(),
  };
}

export function mealTemplateFromRow(row: MealTemplateRow): MealTemplate {
  return {
    id: row.id,
    name: row.name,
    foods: row.foods,
    sortOrder: row.sort_order ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Recipes ───────────────────────────────────────────────────────────────

export type RecipeRow = {
  id: string;
  user_id: string;
  name: string;
  ingredients: Recipe["ingredients"];
  cuisine: string | null;
  notes: string | null;
  sort_order?: number | null;
  /** Public share slug. NULL when the recipe isn't shared; non-null
   *  rows are visible to anon via the `recipes_public_read_shared`
   *  RLS policy (migration 0009). */
  share_slug?: string | null;
  /** Visibility of the share (migration 0010). Only meaningful when
   *  share_slug is set. `null` for legacy rows is treated as
   *  `'public'` by the RLS policies. */
  share_visibility?: "public" | "members" | "disabled" | null;
  // Structured metadata fields added in migration 0039. All nullable
  // — pre-migration recipes and manually-entered recipes leave them
  // unset; the URL-import flow populates them.
  source_url?: string | null;
  servings?: number | null;
  prep_time_minutes?: number | null;
  created_at: string;
  updated_at: string;
};

export function recipeToRow(
  userId: string,
  recipe: Recipe & { sortOrder?: number },
): Omit<RecipeRow, "updated_at"> {
  return {
    id: recipe.id,
    user_id: userId,
    name: recipe.name,
    ingredients: recipe.ingredients,
    cuisine: recipe.cuisine ?? null,
    notes: recipe.notes ?? null,
    sort_order: recipe.sortOrder ?? null,
    share_slug: recipe.shareSlug ?? null,
    share_visibility: recipe.shareVisibility ?? null,
    source_url: recipe.sourceUrl ?? null,
    servings: recipe.servings ?? null,
    prep_time_minutes: recipe.prepTimeMinutes ?? null,
    created_at: new Date(recipe.createdAt).toISOString(),
  };
}

/** The IDB row carries `sortOrder` (per the `Sortable` mixin in
 *  `lib/db.ts`); the global `Recipe` type doesn't, so the mapper
 *  returns a widened type that includes the optional field. Sync's
 *  `applyServerRecipe` accepts the wider shape. */
export function recipeFromRow(row: RecipeRow): Recipe & { sortOrder?: number } {
  return {
    id: row.id,
    name: row.name,
    ingredients: row.ingredients,
    cuisine: row.cuisine ?? undefined,
    notes: row.notes ?? undefined,
    sortOrder: row.sort_order ?? undefined,
    shareSlug: row.share_slug ?? undefined,
    shareVisibility: row.share_visibility ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    servings: row.servings ?? undefined,
    prepTimeMinutes: row.prep_time_minutes ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Meal schedules ──────────────────────────────────────────────────────────

export type MealScheduleRow = {
  id: string;
  user_id: string;
  /** Snapshot of the recipe name at schedule time (list label). */
  name: string;
  recipe_id: string;
  meal_names: string[];
  start_date: string;
  end_date: string;
  days_of_week: number[];
  scale: number;
  sort_order?: number | null;
  created_at: string;
  updated_at: string;
};

export function mealScheduleToRow(
  userId: string,
  schedule: MealSchedule,
): Omit<MealScheduleRow, "updated_at"> {
  return {
    id: schedule.id,
    user_id: userId,
    name: schedule.recipeName,
    recipe_id: schedule.recipeId,
    meal_names: schedule.mealNames,
    start_date: schedule.startDate,
    end_date: schedule.endDate,
    days_of_week: schedule.daysOfWeek,
    scale: schedule.scale,
    sort_order: schedule.sortOrder ?? null,
    created_at: new Date(schedule.createdAt).toISOString(),
  };
}

export function mealScheduleFromRow(row: MealScheduleRow): MealSchedule {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    recipeName: row.name,
    mealNames: row.meal_names,
    startDate: row.start_date,
    endDate: row.end_date,
    daysOfWeek: row.days_of_week,
    scale: row.scale,
    sortOrder: row.sort_order ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Supplements ─────────────────────────────────────────────────────────────

export type SupplementRow = {
  id: string;
  user_id: string;
  name: string;
  dose_label: string;
  micros: MicronutrientValues;
  /** Optional reminder schedule — absent (null) when the user logs ad-hoc. */
  schedule: SupplementSchedule | null;
  notes: string | null;
  sort_order?: number | null;
  created_at: string;
  updated_at: string;
};

export function supplementToRow(
  userId: string,
  supplement: Supplement,
): Omit<SupplementRow, "updated_at"> {
  return {
    id: supplement.id,
    user_id: userId,
    name: supplement.name,
    dose_label: supplement.doseLabel,
    micros: supplement.micros,
    schedule: supplement.schedule ?? null,
    notes: supplement.notes ?? null,
    sort_order: supplement.sortOrder ?? null,
    created_at: new Date(supplement.createdAt).toISOString(),
  };
}

export function supplementFromRow(row: SupplementRow): Supplement {
  return {
    id: row.id,
    name: row.name,
    doseLabel: row.dose_label,
    micros: row.micros,
    schedule: row.schedule ?? undefined,
    notes: row.notes ?? undefined,
    sortOrder: row.sort_order ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Pantry items ────────────────────────────────────────────────────────────

export type PantryItemRow = {
  id: string;
  user_id: string;
  name: string;
  quantity: number;
  unit: string;
  note: string | null;
  category: string | null;
  density: number | null;
  low_threshold: number | null;
  created_at: string;
  updated_at: string;
};

export function pantryItemToRow(
  userId: string,
  item: PantryItem,
): Omit<PantryItemRow, "updated_at"> {
  return {
    id: item.id,
    user_id: userId,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    note: item.note ?? null,
    category: item.category ?? null,
    density: item.density ?? null,
    low_threshold: item.lowThreshold ?? null,
    created_at: new Date(item.createdAt).toISOString(),
  };
}

export function pantryItemFromRow(row: PantryItemRow): PantryItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    note: row.note ?? undefined,
    category: (row.category as PantryItem["category"]) ?? undefined,
    density: row.density ?? undefined,
    lowThreshold: row.low_threshold ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Pantry notifications ─────────────────────────────────────────────────────

export type PantryNotificationRow = {
  id: string;
  user_id: string;
  type: "low-stock";
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  read: boolean;
  created_at: string;
  updated_at: string;
};

export function pantryNotificationToRow(
  userId: string,
  notif: PantryNotification,
): Omit<PantryNotificationRow, "updated_at"> {
  return {
    id: notif.id,
    user_id: userId,
    type: notif.type,
    item_id: notif.itemId,
    item_name: notif.itemName,
    quantity: notif.quantity,
    unit: notif.unit,
    read: notif.read,
    created_at: new Date(notif.createdAt).toISOString(),
  };
}

export function pantryNotificationFromRow(
  row: PantryNotificationRow,
): PantryNotification {
  return {
    id: row.id,
    type: row.type,
    itemId: row.item_id,
    itemName: row.item_name,
    quantity: row.quantity,
    unit: row.unit,
    read: row.read,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Favourite stores ─────────────────────────────────────────────────────────

export type FavoriteStoreRow = {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  address: string | null;
  created_at: string;
  updated_at: string;
};

export function favoriteStoreToRow(
  userId: string,
  store: FavoriteStore,
): Omit<FavoriteStoreRow, "updated_at"> {
  return {
    id: store.id,
    user_id: userId,
    name: store.name,
    kind: store.kind,
    lat: store.lat,
    lon: store.lon,
    address: store.address ?? null,
    created_at: new Date(store.createdAt).toISOString(),
  };
}

export function favoriteStoreFromRow(row: FavoriteStoreRow): FavoriteStore {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    lat: row.lat,
    lon: row.lon,
    address: row.address ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

// ─── Favourite foods ──────────────────────────────────────────────────────────

export type FavoriteFoodRow = {
  id: string;
  user_id: string;
  name_key: string;
  /** The addable per-100g food, stored as a JSONB column. */
  food: Food;
  portion: number;
  created_at: string;
  updated_at: string;
};

export function favoriteFoodToRow(
  userId: string,
  fav: FavoriteFood,
): Omit<FavoriteFoodRow, "updated_at"> {
  return {
    id: fav.id,
    user_id: userId,
    name_key: fav.nameKey,
    food: fav.food,
    portion: fav.portion,
    created_at: new Date(fav.createdAt).toISOString(),
  };
}

export function favoriteFoodFromRow(row: FavoriteFoodRow): FavoriteFood {
  return {
    id: row.id,
    nameKey: row.name_key,
    food: row.food,
    portion: row.portion,
    createdAt: Date.parse(row.created_at),
  };
}

// ─── Micronutrient profiles ───────────────────────────────────────────────────

export type MicronutrientProfileRow = {
  // Server PK is a uuid, but the local store keys by name_key. We don't
  // round-trip the uuid (the client never reads it) — name_key is the
  // stable identity both sides agree on via the unique constraint.
  user_id: string;
  name_key: string;
  values: MicronutrientValues;
  source: "barcode" | "ciqual" | "search" | "ai" | "miss";
  source_code: string | null;
  /** Per-100g macro-breakdown backfill (migration 0065); null on rows
   *  written before the column existed. */
  breakdown: MacroBreakdown | null;
  enriched_at: string;
  updated_at: string;
};

export function micronutrientProfileToRow(
  userId: string,
  profile: MicronutrientProfile,
): Omit<MicronutrientProfileRow, "updated_at"> {
  return {
    user_id: userId,
    name_key: profile.nameKey,
    values: profile.valuesPer100g,
    source: profile.source,
    source_code: profile.sourceCode ?? null,
    breakdown: profile.breakdownPer100g ?? null,
    enriched_at: new Date(profile.enrichedAt).toISOString(),
  };
}

export function micronutrientProfileFromRow(
  row: MicronutrientProfileRow,
): MicronutrientProfile {
  return {
    nameKey: row.name_key,
    valuesPer100g: row.values ?? {},
    source: row.source,
    sourceCode: row.source_code ?? undefined,
    breakdownPer100g: row.breakdown ?? undefined,
    enrichedAt: Date.parse(row.enriched_at),
  };
}
