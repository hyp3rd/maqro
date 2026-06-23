import type { MicronutrientValues } from "./rda";
import type { Food, FoodItem, Meal } from "./types";

/** Persisted-record domain types — the shapes stored locally (IndexedDB) and
 *  synced to Supabase. Pure types, shared with the native app; the web storage
 *  layer (`@/lib/db`) re-exports them so existing imports are unchanged. */

/** Sync-engine metadata mixed into every persisted record. Optional so plain
 *  object literals (forms, mappers, tests) don't have to know about sync
 *  internals — the storage layer fills them in, and the sync engine treats
 *  missing / null as "never synced". */
export type Versioned = {
  localUpdatedAt?: string;
  serverUpdatedAt?: string | null;
};

/** A single day's meal log, keyed by `YYYY-MM-DD` in the user's local
 *  timezone. The `meals` shape mirrors the in-memory `Meal[]` exactly. */
export type DailyLog = {
  date: string;
  meals: Meal[];
  /** Legacy ms-epoch timestamp from pre-v7 rows. Kept for backwards
   *  compatibility while migrating; new writes set the `Versioned` fields. */
  updatedAt: number;
} & Versioned;

/** A single weigh-in, keyed by `YYYY-MM-DD` local date — same-day writes
 *  overwrite, so the latest weigh-in for a day wins. */
export type WeightEntry = {
  date: string;
  kg: number;
  recordedAt: number;
} & Versioned;

/** Optional per-row position for the "custom" sort mode (My Foods / Recipes /
 *  Templates). A `double precision` (number), not an integer, so inserting
 *  between two rows is just the average of the neighbors — no renumber cascade.
 *  Nullable for rows the user hasn't manually positioned; those fall back to
 *  `createdAt`. */
export type Sortable = { sortOrder?: number };

/** Stored custom food. Macros are per 100g; the id is a client-minted UUID so
 *  the same record exists in IndexedDB and Supabase under the same key (no
 *  mapping for sync). `createdAt` drives most-recent ordering. */
export type CustomFood = Omit<Food, "id" | "source"> & {
  id: string;
  createdAt: number;
} & Versioned &
  Sortable;

/** A reusable meal template — a named set of foods (e.g. "Greek yogurt bowl")
 *  applicable to any meal slot on any day. `foods` is captured with portions
 *  as-saved; id is a client-minted UUID shared with Supabase. */
export type MealTemplate = {
  id: string;
  name: string;
  foods: FoodItem[];
  createdAt: number;
  /** Legacy ms-epoch timestamp, still bumped on local writes so the list-sort
   *  ("most recently edited first") keeps working — `localUpdatedAt` is the
   *  authoritative one for sync. */
  updatedAt: number;
} & Versioned &
  Sortable;

/** A day's cumulative water intake in millilitres. Keyed by `YYYY-MM-DD` local
 *  date — one row per day, accumulated as the user logs. Mirrors `WeightEntry`'s
 *  date-keyed, last-write-wins shape. */
export type WaterIntake = {
  date: string;
  ml: number;
  recordedAt: number;
} & Versioned;

/** A single body-measurement entry — waist / neck / hips in cm + an optional
 *  note. All circumferences optional so the user can log just what they have.
 *  Keyed by `YYYY-MM-DD` — most-recent measurement on a day wins. */
export type BodyMeasurement = {
  date: string;
  waistCm?: number;
  neckCm?: number;
  hipsCm?: number;
  notes?: string;
  recordedAt: number;
} & Versioned;

/** A single blood-pressure reading — systolic / diastolic in mmHg, optional
 *  pulse (bpm) + note. Both pressures required (a reading needs the pair).
 *  Always mmHg — no imperial variant. Keyed by `YYYY-MM-DD` — most-recent
 *  reading on a day wins. */
export type BloodPressure = {
  date: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  notes?: string;
  recordedAt: number;
} & Versioned;

/** A pantry notification — currently only "low-stock", fired when consuming a
 *  recipe pushes an item's quantity to/below its threshold. Synced so the bell
 *  badge + history stay consistent across devices. `itemId` is a plain link
 *  (not an FK — the item may change independently and the event is still
 *  valid). `read` toggles when the user opens the drawer. */
export type PantryNotification = {
  id: string;
  type: "low-stock";
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  read: boolean;
  createdAt: number;
  updatedAt: number;
} & Versioned;

/** A recipe scheduled to one or more meal slots across a date range + set of
 *  weekdays — the meal-prep "cook once, log for…" plan. A schedule does NOT
 *  write any log: the day view stays gated to today, so nothing is written
 *  ahead. Instead it's surfaced on each matching day as a one-tap "log it"
 *  offer. `recipeId` resolves to the *current* recipe at log time; `recipeName`
 *  is a snapshot so the list still reads right after a rename. */
export type MealSchedule = {
  id: string;
  recipeId: string;
  recipeName: string;
  /** Target slot names, lower-cased — matched by name on the day (slot ids
   *  drift as the user edits their meal template; the name is the handle). */
  mealNames: string[];
  startDate: string;
  endDate: string;
  /** 0=Sun … 6=Sat. Empty = no day matches. */
  daysOfWeek: number[];
  /** Servings multiplier applied to the recipe at log time. */
  scale: number;
  createdAt: number;
  updatedAt: number;
} & Versioned &
  Sortable;

/** An optional reminder schedule riding a `Supplement` (one schedule per
 *  supplement). A reminder fires when the user's local hour is in `reminderTimes`
 *  AND the local weekday is in `daysOfWeek`. Empty arrays = no reminders. */
export type SupplementSchedule = {
  /** Hours-of-day to remind at (0–23, local). */
  reminderTimes: number[];
  /** 0=Sun … 6=Sat the reminders fire on. */
  daysOfWeek: number[];
};

/** A reusable supplement definition the user logs + (optionally) schedules. The
 *  nutrient payload is the ABSOLUTE amount provided per dose (NOT per-100g like a
 *  food) — e.g. a 25µg vitamin-D capsule is `{ vitaminD: 25 }`. It reuses the
 *  micronutrient key set so it feeds the same daily totals. id is a client-minted
 *  UUID shared with Supabase. A **Pro** feature — gated alongside micronutrient
 *  tracking. */
export type Supplement = {
  id: string;
  name: string;
  /** Free-text dose label shown in the UI, e.g. "1000 IU / 25µg · 1 capsule". */
  doseLabel: string;
  /** Absolute micronutrient amounts per dose, in the catalog's canonical units. */
  micros: MicronutrientValues;
  /** Optional reminder schedule. Absent = the user just logs it ad-hoc. */
  schedule?: SupplementSchedule;
  notes?: string;
  createdAt: number;
  updatedAt: number;
} & Versioned &
  Sortable;

/** One taken-supplement entry within a day. */
export type SupplementIntakeEntry = {
  supplementId: string;
  /** Number of doses taken (1 = a single dose). Multiplies the supplement's
   *  per-dose micros when feeding the daily totals. */
  doses: number;
};

/** What supplements the user actually took on a given day — the input to the
 *  micronutrient feed. Keyed by `YYYY-MM-DD` local date; one row per day,
 *  last-write-wins (mirrors `WaterIntake`). */
export type SupplementIntake = {
  date: string;
  taken: SupplementIntakeEntry[];
  recordedAt: number;
} & Versioned;
