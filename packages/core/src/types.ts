import type { MicronutrientValues } from "./rda";

export type FoodSource = "builtin" | "custom" | "off" | "ciqual";

/** Animal-vs-plant classification used by the diet filter. Built-in foods
 * derive this from `category`/`subCategory`; custom foods set it explicitly
 * via the My Foods form so the planner never ships a salmon fillet into a
 * vegan plan. `undefined` is treated as "unknown" → omnivore-only. */
export type FoodKind =
  | "land-meat"
  | "seafood"
  | "egg"
  | "dairy"
  | "honey"
  | "plant";

/** Optional macro-breakdown fields surfaced "where available" - OFF
 *  lookups, AI vision, or user-entered custom foods can populate them;
 *  the seed catalog leaves them blank. The display layer skips a row
 *  entirely when no source food in the current view contributes a
 *  value (rather than rendering a misleading "0g" for unknown). */
export type MacroBreakdown = {
  /** Total sugars per 100g, of which "added sugars" is a subset. */
  sugars?: number;
  addedSugars?: number;
  fiber?: number;
  saturatedFat?: number;
  transFat?: number;
  monoFat?: number;
  polyFat?: number;
};

export type Food = {
  /** Stable identifier across the three sources. Builtin derives from name,
   * custom uses the IndexedDB key, OFF uses the product barcode. */
  id?: string;
  source?: FoodSource;
  name: string;
  /** Macros are per 100g so portion sizing stays linear. */
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  category?: string;
  subCategory?: string;
  mealTypes?: string[];
  brand?: string;
  /** Explicit diet classification - when set, the diet filter trusts this
   * over the category-derived classifier. Set on custom foods at create
   * time; built-in foods can rely on category/subCategory instead. */
  dietKind?: FoodKind;
  /** Per-100g micronutrients (vitamins, minerals, fiber), populated
   *  by an Open Food Facts import (`hitToFood`). Optional and sparse —
   *  OFF rarely has all ten, and the seed catalog / AI-vision paths
   *  leave it blank. Distinct from `MacroBreakdown` (which fiber also
   *  appears in): this is the nested object the micronutrient panel +
   *  report read, in each nutrient's canonical unit per
   *  [lib/rda.ts](../../lib/rda.ts). */
  micronutrients?: MicronutrientValues;
} & MacroBreakdown;

export type FoodItem = {
  id: number;
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  portionSize: number;
  selectedMealId?: number;
  category?: string;
  subCategory?: string;
  /** Set when this meal food was matched to a pantry item on add, so a
   *  portion edit can re-scale the draw-down and removal / replacement
   *  can restore it. `consumedQty` is the amount actually subtracted, in
   *  the pantry item's own unit. Persisted with the meal (daily_logs
   *  stores `meals` as JSON), so the link survives reloads. */
  pantrySource?: { itemId: string; consumedQty: number };
  /** Open Food Facts product code captured at log time (from the catalog
   *  `Food.id` "off:<code>" — search picks and barcode scans alike). Lets
   *  the micronutrient-enrichment cron resolve the EXACT product instead
   *  of a name-search median or an AI estimate — the accuracy difference
   *  for branded foods. Rides the meals JSONB; no migration needed. */
  offCode?: string;
  originalValues?: {
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
    caloriesPer100g: number;
    /** Per-100g sub-macros at meal-add time, captured so per-meal
     *  scaling math (`portion/100 * value`) works without re-resolving
     *  the source food. All optional. */
  } & MacroBreakdown;
  /** Per-100g micronutrients carried from the source food at add-time
   *  (NOT scaled to portion — the micronutrient aggregator multiplies
   *  by `portionSize/100` itself, identically to how it scales the
   *  name-keyed profile cache). Stored at the top level rather than in
   *  `originalValues` so a single field round-trips through the meals
   *  JSONB; when present it lets the aggregator read exact per-product
   *  values instead of the approximate name-keyed profile. Note this
   *  per-100g convention differs from the scaled top-level
   *  `MacroBreakdown` sub-macros above — micronutrients are a separate,
   *  later subsystem with their own aggregation. */
  micronutrients?: MicronutrientValues;
  /** Wall-clock time (ms epoch) this food was actually *logged as eaten*.
   *  Set ONLY by real logging actions (manual add / search / quick-add /
   *  photo·voice·barcode / copy-a-meal) and ONLY when logging to today —
   *  never by AI-generated plans, templates, or recipes, which are intent
   *  not consumption. The intermittent-fasting features read this to derive
   *  eating windows + the fast timer; foods without it (plans, pre-feature
   *  logs) are ignored. Rides the existing `meals` JSONB — no migration,
   *  like `micronutrients` above. */
  loggedAt?: number;
} & MacroBreakdown;

export type Meal = { id: number; name: string; foods: FoodItem[] };

/** One ingredient in a saved Recipe. We store the catalog reference by
 *  name (matching how `MealTemplate.foods` already works) plus a frozen
 *  per-100g macro snapshot so the recipe's macros are stable even when an
 *  OFF result's name normalization drifts or the source food is later
 *  edited / deleted. Portion is in grams. */
export type RecipeIngredient = {
  foodName: string;
  /** Per-100g macros at recipe-save time. Falls back here when the live
   * catalog can't resolve `foodName`. */
  macrosPer100g: {
    protein: number;
    carbs: number;
    fat: number;
    calories: number;
  };
  portionGrams: number;
  /** Optional classification snapshot so `recipeDietCompatibility` doesn't
   *  re-classify against a possibly-stale catalog every time. `undefined`
   *  means "unknown" (omnivore-only by the diet filter's convention). */
  dietKind?: FoodKind;
  /** Per-100g micronutrients frozen at recipe-save time, mirroring
   *  `macrosPer100g`. Populated when the source food carried OFF
   *  micronutrient data; absent otherwise. Applying the recipe to a
   *  meal carries this onto each ingredient's `FoodItem.micronutrients`
   *  so the micronutrient aggregator counts recipe-logged foods just
   *  like directly-logged ones. Stored inside the recipe's JSONB
   *  `ingredients` blob, so no schema migration is needed. */
  micronutrientsPer100g?: MicronutrientValues;
};

/** A user-saved recipe - a named bundle of ingredients with optional prep
 *  notes and a cuisine tag. Macros are computed deterministically from the
 *  per-ingredient snapshot × portion. Diet compatibility is derived on the
 *  fly from `dietKind`s so it never drifts. */
export type Recipe = {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  /** Free-text, with `CUISINES` as autocomplete hints in the form. */
  cuisine?: string;
  /** Optional prep notes - ≤500 chars, plain text. */
  notes?: string;
  /** When set, the recipe is shared at `/r/<shareSlug>`. The owner
   *  mints/revokes via the share dialog; everyone else hits the
   *  public page subject to `shareVisibility`. `undefined` = not
   *  shared at all. */
  shareSlug?: string;
  /** Who can resolve a shared link. Only meaningful when `shareSlug`
   *  is set. `'public'` (default) = anyone with the URL; `'members'`
   *  = signed-in users only; `'disabled'` = the slug exists but the
   *  page 404s (lets the owner pause sharing without losing the URL).
   *  Revoking via the share dialog clears `shareSlug` entirely. */
  shareVisibility?: "public" | "members" | "disabled";
  /** Origin URL when the recipe was imported via the URL importer.
   *  Always https:// - the DB enforces via CHECK constraint and the
   *  client validates through the same `validateUrl` gate the import
   *  fetcher uses. Null/undefined for manually-entered recipes. */
  sourceUrl?: string;
  /** How many people/portions this recipe makes. Acts as the
   *  denominator for view-time scaling - RecipeViewDialog's "scale to
   *  N servings" multiplies ingredient portions by (N / servings). */
  servings?: number;
  /** Total preparation time in minutes. Imported from schema.org
   *  totalTime or AI extraction; user can edit. */
  prepTimeMinutes?: number;
  createdAt: number;
  updatedAt: number;
};

export type ShareVisibility = NonNullable<Recipe["shareVisibility"]>;

/** Mifflin-St Jeor only distinguishes between two formulas (+5 vs -161).
 * We keep the form inclusive - anyone who doesn't identify as male picks
 * the more conservative ("pessimistic") -161 path so calorie targets
 * never over-estimate. Manual TDEE override is available for users who
 * want to calibrate against real measurements. */
export type Gender = "male" | "female" | "nonbinary" | "preferNotToSay";

/** Animal-vs-plant dietary restrictions. Independent of `dietType` (which
 * is about macro distribution). Plumbed into the meal-planner so generated
 * plans only include foods the user actually eats. */
export type DietPreference =
  | "omnivore"
  | "vegetarian"
  | "vegan"
  | "pescatarian"
  | "carnivore";

/** Curated list of cuisines the user enjoys. Used as a soft hint to the
 * AI meal planner - e.g. an "Italian + Mediterranean" pick produces
 * different breakfasts than an "Korean + Japanese" pick. Empty array
 * means "no preference, plan freely". */
export type Cuisine =
  | "Italian"
  | "Mediterranean"
  | "French"
  | "Mexican"
  | "American"
  | "Chinese"
  | "Japanese"
  | "Korean"
  | "Thai"
  | "Vietnamese"
  | "Indian"
  | "Middle Eastern"
  | "African"
  | "Caribbean"
  | "Eastern European";

/** Closed list of cuisines used by the form and the AI prompt. */
export const CUISINES: readonly Cuisine[] = [
  "Italian",
  "Mediterranean",
  "French",
  "Mexican",
  "American",
  "Chinese",
  "Japanese",
  "Korean",
  "Thai",
  "Vietnamese",
  "Indian",
  "Middle Eastern",
  "African",
  "Caribbean",
  "Eastern European",
] as const;

/** Optional manual macro split. When set, overrides the goal+dietType-derived
 * ratios in `computeMacros`. The three values are percentages (0–100) and
 * should sum to ~100; the formula re-normalizes so a slightly-off sum still
 * produces sensible targets. Power-user knob - leave null for the default
 * goal-aware split. */
export type MacroSplit = { protein: number; carbs: number; fat: number };

/** The kind of a goal phase. Maps to a `goal` direction in `computeMacros`:
 * `cut` → lose, `leanBulk` → gain, `maintenance`/`dietBreak` → maintain. The
 * `dietBreak` is a planned spell at maintenance to relieve a long deficit. */
export type GoalPhaseKind = "cut" | "dietBreak" | "maintenance" | "leanBulk";

/** One phase in a goal-phase plan. Ordered by `startDate`; the phase whose
 * `[startDate, startDate + durationWeeks*7)` window contains today drives the
 * target. `weeklyRateKg` is sign-less (the kind sets the direction) and only
 * meaningful for `cut`/`leanBulk`; it respects the same ≤1%-bodyweight cap as
 * `PersonalInfo.weeklyRateKg`. */
export type GoalPhase = {
  /** Client-minted id (stable across edits + sync). */
  id: string;
  kind: GoalPhaseKind;
  /** Local `YYYY-MM-DD` the phase starts. */
  startDate: string;
  durationWeeks: number;
  weeklyRateKg: number;
  /** Optional free-text label ("off-season", "holiday"). */
  notes?: string;
};

export type PersonalInfo = {
  /** Optional display name shown in the sidebar instead of the email
   * prefix. Pure UX nicety - has no effect on calculations or AI. */
  displayName?: string | null;
  gender: Gender;
  age: number;
  /** Optional birthdate (`YYYY-MM-DD`). When set, the user's age is derived
   * from it and stays current automatically (so the calorie target shifts
   * silently on a birthday) — see [lib/age.ts](../../lib/age.ts)
   * `effectiveAge`. The `age` above remains the fallback for profiles from
   * before this field existed. Rides the profile blob — no migration. */
  birthDate?: string;
  weight: number;
  height: number;
  activityLevel: "sedentary" | "light" | "moderate" | "active" | "veryActive";
  goal: "lose" | "maintain" | "gain";
  dietType: "balanced" | "lowCarb" | "lowFat";
  dietPreference: DietPreference;
  /** Cuisines the user enjoys. Soft hint to the AI planner; empty = no
   * preference. Kept open-ended (string, not the Cuisine union) so old
   * profiles with values we've since removed still round-trip. */
  cuisinePreferences: string[];
  /** Free-form list of allergens or ingredients the user can't / won't
   * eat. The AI planner must filter these out hard. Examples: "peanuts",
   * "shellfish", "celery", "gluten". */
  allergies: string[];
  /** Soft signal to the AI planner - foods the user dislikes but isn't
   * allergic to. Unlike `allergies` this is *not* a hard filter; the AI
   * is told to avoid them when possible but the converter doesn't drop
   * picks that match. Examples: "oats", "tofu", "broccoli". */
  dislikedFoods: string[];
  /** Target weight change rate in kg/week. Sign-less; the `goal` field
   * determines whether it's a deficit or surplus. Ignored when goal is
   * "maintain". 1 kg fat ≈ 7700 kcal → daily delta ≈ rate × 1100. */
  weeklyRateKg: number;
  /** Optional measured TDEE override. When set (non-null and > 0), bypasses
   * the BMR × activity multiplier estimate. Use this when you've calibrated
   * against real-world weight change - formula-based TDEE estimates run
   * 10–20% high for many people. */
  manualTdee?: number | null;
  /** Opt-in to hands-off weekly auto-adapt of the maintenance TDEE (Pro). When
   * true, the weekly cron re-estimates maintenance from logged intake vs. the
   * weight trend and applies small changes automatically (holding larger ones
   * for confirmation — see `autoAdaptSuggestion`). Off/absent = the estimate
   * stays advisory (the Progress card + Calculator badge only). Rides the
   * profile blob — no migration. */
  autoAdaptTdee?: boolean;
  /** The latest weekly auto-adapt outcome, surfaced in-app (it doubles as the
   * "you were notified" record). `kind: "applied"` = a small change the cron
   * already wrote to `manualTdee` (shown as a reversible heads-up); `kind:
   * "pending"` = a large change held for a one-tap confirm. Cleared once the
   * user applies or dismisses it. `tdee` is the maintenance value, `deltaKcal`
   * the signed change vs. the prior basis, `createdAt` ms epoch. Rides the
   * profile blob — no migration. */
  autoAdaptSuggestion?: {
    kind: "applied" | "pending";
    tdee: number;
    deltaKcal: number;
    createdAt: number;
  } | null;
  /** Optional manual macro split (percentages). When set + valid, overrides
   * the default goal+dietType-derived ratios in `computeMacros`. */
  macroSplit?: MacroSplit | null;
  /** Optional manual daily water-intake goal in millilitres. When unset
   * (null/undefined), the goal is derived from bodyweight (≈35 ml/kg,
   * clamped) — see [lib/hydration.ts](../../lib/hydration.ts). Stored in ml
   * regardless of the `units` display preference, like every other metric. */
  waterGoalMl?: number | null;
  /** Intermittent-fasting config. Absent/`enabled:false` = the feature is
   * off (no card, no Topbar chip). `protocol` sets the fasting-hours target
   * (16:8 → 16h fast, etc.); `custom` reads `customFastingHours`.
   * `fastStartedAt` is the manual "Start fast" anchor (ms epoch) that
   * overrides the auto-derived last-meal time until a later real food log
   * supersedes it. See [lib/fasting.ts](../../lib/fasting.ts). Rides the
   * profile blob — no migration, like `waterGoalMl`. */
  fasting?: {
    enabled: boolean;
    protocol: "16:8" | "18:6" | "20:4" | "custom";
    customFastingHours?: number;
    fastStartedAt?: number | null;
  };
  /** Ordered goal-phase plan (cut → diet break → maintenance → lean bulk).
   * The phase active on today's date overrides `goal` + `weeklyRateKg` in
   * `computeMacros`, so the calorie/macro target shifts as phases transition.
   * A **Pro** feature — see [lib/goal-phases.ts](../../lib/goal-phases.ts);
   * when absent / not Pro / no phase active, the linear `goal` above is the
   * target. Rides the profile blob — no migration, like `fasting`. */
  goalPhases?: GoalPhase[];
  /** Display preference for weight + height: metric (kg / cm) or
   *  imperial (lb / ft+in). Storage stays in kg / cm regardless;
   *  this only governs how values are presented and entered. See
   *  [lib/units.ts](../../lib/units.ts) for the conversion rules
   *  and the "storage is always metric" rationale. */
  units: "metric" | "imperial";
  /** Synced "home market" — the shopping country the food search biases Open
   *  Food Facts toward, overriding the browser-region default. Settable in
   *  Settings; a per-device on-the-go override can still win locally. See
   *  [lib/market.ts](../../lib/market.ts). Rides the profile blob — no
   *  migration, like `fasting`. Validated against the supported set on read. */
  market?: MarketCode;
};

/** Supported "shopping market" country codes (ISO 3166-1 alpha-2) plus
 *  `"world"` (no country bias). The display list + the Open Food Facts tag
 *  mapping live in [lib/markets.ts](../../lib/markets.ts). */
export type MarketCode =
  | "world"
  | "FR"
  | "DE"
  | "IT"
  | "ES"
  | "GB"
  | "NL"
  | "BE"
  | "PT"
  | "IE"
  | "AT"
  | "CH"
  | "US";

export type CalculatedValues = {
  bmr: number;
  tdee: number;
  targetCalories: number;
  /** Per-day delta from TDEE. Negative = deficit, positive = surplus. */
  dailyDelta: number;
  /** Per-day delta that was *requested* before clamping to safety floor.
   * If `dailyDelta` !== `requestedDelta`, the UI should warn that the
   * deficit is being capped. */
  requestedDelta: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type TotalMacros = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
};

// Constants
export const activityMultipliers: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

/** Calories per kg of body-weight change. ~7700 kcal/kg fat is the textbook
 * figure; recent research suggests 7000–7700 depending on body composition.
 * Use 7700 as a conservative default - it under-estimates loss, which is
 * safer than over-promising. */
export const KCAL_PER_KG = 7700;

/** Floor for daily calories. Going below BMR for sustained periods is
 * unsafe and unsustainable. We also floor at an absolute 1200 to catch
 * cases where BMR estimates run low. */
export const MIN_DAILY_KCAL = 1200;

/** Direction multiplier per goal. */
export const goalDirection: Record<PersonalInfo["goal"], -1 | 0 | 1> = {
  lose: -1,
  maintain: 0,
  gain: 1,
};
