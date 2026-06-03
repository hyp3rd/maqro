import type {
  Food,
  FoodItem,
  Meal,
  PersonalInfo,
  Recipe,
} from "@/components/macro/types";
import type { MicronutrientProfile } from "@/lib/micronutrients/types";
import type { ShoppingAisle } from "@/lib/shopping/categorize";
import { notifyDataChanged } from "@/lib/sync/data-bus";
import { type DBSchema, type IDBPDatabase, openDB } from "idb";

const DB_NAME = "maqro";
const DB_VERSION = 16;

const STORE_CUSTOM_FOODS = "customFoods";
const STORE_PROFILE = "profile";
const STORE_DAILY_LOGS = "dailyLogs";
const STORE_MEAL_TEMPLATES = "mealTemplates";
const STORE_WEIGHT_HISTORY = "weightHistory";
const STORE_WATER_INTAKE = "waterIntake";
const STORE_BODY_MEASUREMENTS = "bodyMeasurements";
const STORE_RECIPES = "recipes";
const STORE_PANTRY_ITEMS = "pantryItems";
const STORE_PANTRY_NOTIFICATIONS = "pantryNotifications";
const STORE_FAVORITE_STORES = "favoriteStores";
const STORE_FAVORITE_FOODS = "favoriteFoods";
/** Per-shopping-list-item user overrides: a chosen aisle (from the
 *  drag-and-drop in ShoppingListView) and a free-text note. Local-
 *  only for v1 — no sync mapper yet — so the meta lives on the
 *  device where it was edited. Future pass can wire push/pull the
 *  same way bodyMeasurements did. */
const STORE_SHOPPING_LIST_META = "shoppingListMeta";
/** Per-food-name micronutrient profiles — the derived cache the
 *  enrichment cron writes and the Progress view / report reads. Keyed
 *  by the lowercased + trimmed food name so a logged food joins to its
 *  profile without a re-key. Synced (Pro-only) so the same enrichment
 *  is available across a user's devices. No tombstones: it's a
 *  derived cache the cron can rebuild, never user-deleted. */
const STORE_MICRONUTRIENT_PROFILES = "micronutrientProfiles";
/** Deletion tombstones. Each entry records "the user deleted row X
 *  from store Y; the sync engine still needs to propagate the delete
 *  to the server". Without this store the silent-resurrection bug:
 *  user deletes a template locally → sync's pull pass queries the
 *  server, sees the row, writes it back into IDB. */
const STORE_DELETIONS = "deletions";

/** Single record key under the `profile` store. We only support one
 * profile in phase 2; this constant makes that explicit. */
const PROFILE_KEY = "default";

/** Versioning mixin every synced row carries since v7. Two timestamps:
 *
 *  - `localUpdatedAt` - wall-clock ISO timestamp of the last *local*
 *    modification. Bumped by every save/upsert from user actions.
 *  - `serverUpdatedAt` - the server's `updated_at` when this row was
 *    last pulled or successfully pushed. `null` if the row was created
 *    locally and has never reached the server. Used as the optimistic-
 *    concurrency token (`.eq("updated_at", serverUpdatedAt)`) on the
 *    next push: if the server's current value differs, our update
 *    affects zero rows and we know another device changed it first.
 *
 *  A row is "dirty" - i.e. waiting to be pushed - when
 *  `serverUpdatedAt == null || localUpdatedAt !== serverUpdatedAt`.
 *
 *  Both fields are *optional* on the type so callers that build row
 *  literals (forms, mappers, tests) don't have to know about sync
 *  internals; the saver functions in this file fill them in, and the
 *  sync engine treats missing/null as "never synced". */
export type Versioned = {
  localUpdatedAt?: string;
  serverUpdatedAt?: string | null;
};

/** Optional per-row position used by the "custom" sort mode in the
 *  My Foods / Recipes / Templates views. A `double precision` (number)
 *  rather than an integer so inserting between two rows is just the
 *  average of the neighbors' values - no renumber cascade. Nullable
 *  for rows the user hasn't manually positioned yet; those sort by
 *  `createdAt` as the fallback. */
export type Sortable = { sortOrder?: number };

/** Stores that the sync engine can push DELETEs to. Profile is
 *  excluded (single-row per user; the only deletion is "delete
 *  account" which goes through its own server route). */
export type DeletableStore =
  | "customFoods"
  | "mealTemplates"
  | "recipes"
  | "dailyLogs"
  | "weightHistory"
  | "bodyMeasurements"
  | "pantryItems"
  | "pantryNotifications"
  | "favoriteStores"
  | "favoriteFoods";

/** A tombstone - "delete this row on the server next sync." Composite
 *  key `<store>:<rowKey>` so the same row id across different stores
 *  can't collide. `rowKey` is whatever the store's natural key is:
 *  UUID for custom_foods / meal_templates / recipes; date string for
 *  daily_logs / weight_history. */
export type DeletionRecord = {
  _key: string;
  storeName: DeletableStore;
  rowKey: string;
  deletedAt: number;
};

/** Stored custom food. Macros are per 100g; the id is a client-minted
 * UUID so the same record can exist in IndexedDB and Supabase under the
 * same key (no mapping needed for sync). createdAt drives most-recent
 * ordering. */
export type CustomFood = Omit<Food, "id" | "source"> & {
  id: string;
  createdAt: number;
} & Versioned &
  Sortable;

/** A single day's meal log. Keyed by `YYYY-MM-DD` in the user's local
 * timezone. The `meals` shape mirrors the in-memory `Meal[]` exactly.
 *
 *  NOTE: This shape will be retired in a follow-up pass once the new
 *  per-meal `meals` store is wired through the hooks. The store stays
 *  available here so existing reads keep working during the cutover. */
export type DailyLog = {
  date: string;
  meals: Meal[];
  /** Legacy ms-epoch timestamp from pre-v7 rows. Kept for backwards
   *  compatibility while we migrate; new writes set
   *  `localUpdatedAt`/`serverUpdatedAt` via the Versioned mixin. */
  updatedAt: number;
} & Versioned;

/** A reusable meal template - the user named some set of foods (e.g.
 * "Greek yogurt bowl") and can apply it to any meal slot on any day. The
 * `foods` array is captured with portions as-saved. Id is a client-minted
 * UUID shared with Supabase. */
export type MealTemplate = {
  id: string;
  name: string;
  foods: FoodItem[];
  createdAt: number;
  /** Legacy ms-epoch timestamp. Still bumped on local writes so the
   *  existing list-sort ("most recently edited first") keeps working
   *  without a refactor - `localUpdatedAt` is the authoritative one
   *  for sync. */
  updatedAt: number;
} & Versioned &
  Sortable;

/** A single weigh-in. Keyed by `YYYY-MM-DD` local date - same-day writes
 * overwrite, so the latest weigh-in for a day wins. */
export type WeightEntry = {
  date: string;
  kg: number;
  recordedAt: number;
} & Versioned;

/** A day's cumulative water intake in millilitres. Keyed by `YYYY-MM-DD`
 *  local date — one row per day, accumulated as the user logs (each tap
 *  adds to `ml`). Mirrors `WeightEntry`'s date-keyed, last-write-wins shape;
 *  the saver differs in that it reads-then-adds rather than overwriting. */
export type WaterIntake = {
  date: string;
  ml: number;
  recordedAt: number;
} & Versioned;

/** A single body-measurement entry - waist / neck / hips in cm, plus
 *  an optional free-form note. All circumferences optional so the
 *  user can log just what they have today; the Progress view skips
 *  derived metrics (body-fat estimate) when required inputs are
 *  missing. Keyed by `YYYY-MM-DD` like weighIns - most-recent
 *  measurement on a given day wins. */
export type BodyMeasurement = {
  date: string;
  waistCm?: number;
  neckCm?: number;
  hipsCm?: number;
  notes?: string;
  recordedAt: number;
} & Versioned;

/** A pantry inventory item - something the user has on hand. Quantity
 *  + free-text unit (no unit-conversion engine: "4" / "eggs",
 *  "200" / "g", "1" / "can"). Id is a client-minted UUID shared with
 *  Supabase, same key strategy as recipes / custom foods. `createdAt`
 *  drives most-recent ordering; `updatedAt` keeps the list-sort and
 *  the legacy ms-epoch convention consistent with the other stores. */
export type PantryItem = {
  id: string;
  name: string;
  quantity: number;
  /** Free text - grams, count, "cans", whatever the user types. */
  unit: string;
  note?: string;
  /** User-set store aisle override. When unset, the aisle is derived
   *  from the name via `categorizeFallback`; this lets the user correct
   *  a wrong guess (e.g. an item that auto-classed as "Other"). */
  category?: ShoppingAisle;
  /** Density in g/ml, used to draw a volume-unit item (ml, l, cup…) down
   *  by a recipe's grams. Unset → ~1 (water-like). Only meaningful for
   *  volume units. */
  density?: number;
  /** Per-item "low stock" threshold in the item's own unit. When the
   *  quantity falls to/below this, the bell fires and the row shows a
   *  "Low" badge. Unset → fall back to the global rule (count items: at
   *  or below `LOW_STOCK_THRESHOLD`; measured items: self-calibrating). */
  lowThreshold?: number;
  createdAt: number;
  updatedAt: number;
} & Versioned;

/** A pantry notification — currently only the "low-stock" kind, fired
 *  when consuming a recipe pushes an item's quantity to/below the
 *  low-stock threshold. Synced so the bell badge + history stay
 *  consistent across the user's devices. `itemId` links back to the
 *  pantry row (kept as a plain field, not an FK, since the item may be
 *  edited/deleted independently and the notification is still a valid
 *  historical event). `read` toggles when the user opens the drawer. */
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

/** Per-item user override for the Shopping List view. Keyed by the
 *  *lowercased* item name (matches the lowercased lookup keys
 *  ShoppingListView builds), so the same physical food survives
 *  rename-by-case ("Olive Oil" vs "olive oil") without splitting
 *  into two rows.
 *
 *  - `category` — aisle override, persisted when the user drags an
 *    item into a different section. Wins over the pantry item's
 *    category and over the deterministic categorizeFallback.
 *  - `notes` — free-text reminder ("get the 1 kg pack", "ask staff
 *    if they have any in the back"). Trimmed; empty/missing means
 *    no note.
 *
 *  Local-only for v1: no sync mapper, no realtime, no tombstones.
 *  Loss-on-device-wipe is acceptable for a notepad-style override —
 *  the deterministic fallback still works. Wiring sync is a
 *  follow-up; the shape's compatible with the Versioned mixin so
 *  the upgrade is non-breaking. */
export type ShoppingListMeta = {
  name: string;
  category?: ShoppingAisle;
  notes?: string;
  /** Manual "extra" added to the shopping list — set by the
   *  "Send to shopping list" action on a low-stock pantry row.
   *  When present the item appears in the shopping list regardless
   *  of whether any logged meal contains it, with this quantity in
   *  the given unit. Cleared by the "Send to pantry" action (the
   *  user bought it) or by an explicit remove button on the row. */
  extraQty?: number;
  extraUnit?: string;
  /** User-chosen quantity override for a *computed* row. Replaces
   *  the `totalGrams` the meal-log aggregator produced, so the user
   *  can say "I actually need 500 g, not the 200 g my logs say" —
   *  the original aggregate stays in the daily logs untouched, the
   *  override only changes what the shopping list (and the PDF
   *  export, and Send-to-pantry) treats as the buy amount. Always
   *  in grams (the unit of `totalGrams`). Doesn't apply to extras,
   *  whose quantity is `extraQty` directly. */
  qtyOverride?: number;
  /** User-chosen override for the `appearances` count on a computed
   *  row — the "5×" cell on the shopping list. The underlying log
   *  aggregate is "I logged this food in N meal slots"; the user
   *  may want to buy fewer or more portions than that. Persisted
   *  in meta so the change survives range switches. Like
   *  `qtyOverride`, this is a display-only override — the
   *  underlying `appearances` value in the aggregator stays
   *  untouched. Doesn't apply to extras, whose appearances are
   *  always 0. */
  appearancesOverride?: number;
  /** User explicitly removed this item from the shopping list. Used
   *  for computed rows ("I logged this but I already have it at
   *  home, don't bother showing it"); persisted so range changes
   *  don't undo the removal, but reversible via the "show hidden"
   *  affordance in the list footer. For extras the same intent is
   *  expressed by clearing `extraQty`; the X button in the row
   *  routes to either path based on `isExtra`. */
  excluded?: boolean;
  updatedAt: number;
};

/** A grocery store the user starred from the "stores near you" results,
 *  synced so favourites follow them across devices. The `id` is the OSM
 *  key (`"<type>/<id>"`, e.g. "node/123"), so re-favouriting the same
 *  shop dedupes. Stores a snapshot of the OSM fields at star-time — we
 *  don't re-fetch live data for favourites. */
export type FavoriteStore = {
  id: string;
  name: string;
  /** OSM `shop` tag value — "supermarket", "grocery", … — for a badge. */
  kind: string;
  lat: number;
  lon: number;
  address?: string;
  createdAt: number;
  updatedAt: number;
} & Versioned;

/** A food the user pinned as a favourite, so it sits at the top of the
 *  quick-add lists. The addable per-100g `food` + default `portion` are
 *  stored inline (the food JSONB column in Supabase) so re-adding needs
 *  no resolution. `id` is a client-minted UUID shared with Supabase;
 *  `nameKey` (lowercased name) is the dedupe key — one favourite per
 *  food — with a byNameKey index for "is this favourited?" lookups. */
export type FavoriteFood = {
  id: string;
  nameKey: string;
  food: Food;
  portion: number;
  createdAt: number;
} & Versioned;

/** Tiny helper that mints the wall-clock timestamp every saver uses.
 *  Centralized so tests can hijack it via vi.useFakeTimers() and the
 *  string format stays consistent. */
function nowIso(): string {
  return new Date().toISOString();
}

/** The profile row stored in IDB. The Versioned mixin tracks sync
 *  state; `_key` is the static keyPath we use because profile is a
 *  single-row store (one profile per user). `getProfile()` strips
 *  these internal fields so callers see a clean PersonalInfo. */
type ProfileRecord = PersonalInfo & { _key: string } & Versioned & {
    /** Marker set when this profile was seeded by `?demo=1` rather than
     *  by a real sign-up. Lives in IDB so it survives a localStorage
     *  failure (the original `DEMO_FLAG_KEY` flag); the sign-in flow
     *  reads either signal to decide whether to wipe demo data before
     *  push. Preserved by `saveProfile` so editing the profile doesn't
     *  un-mark it. */
    _demoSeeded?: true;
  };

interface MacroDB extends DBSchema {
  [STORE_CUSTOM_FOODS]: {
    key: string;
    value: CustomFood;
    indexes: { byName: string };
  };
  [STORE_PROFILE]: { key: string; value: ProfileRecord };
  [STORE_DAILY_LOGS]: { key: string; value: DailyLog };
  [STORE_MEAL_TEMPLATES]: { key: string; value: MealTemplate };
  [STORE_WEIGHT_HISTORY]: { key: string; value: WeightEntry };
  [STORE_WATER_INTAKE]: { key: string; value: WaterIntake };
  [STORE_BODY_MEASUREMENTS]: { key: string; value: BodyMeasurement };
  [STORE_RECIPES]: {
    key: string;
    value: Recipe & Versioned & Sortable;
    indexes: { byName: string };
  };
  [STORE_PANTRY_ITEMS]: {
    key: string;
    value: PantryItem;
    indexes: { byName: string };
  };
  [STORE_PANTRY_NOTIFICATIONS]: {
    key: string;
    value: PantryNotification;
    indexes: { byCreatedAt: number };
  };
  [STORE_FAVORITE_STORES]: {
    key: string;
    value: FavoriteStore;
    indexes: { byCreatedAt: number };
  };
  [STORE_FAVORITE_FOODS]: {
    key: string;
    value: FavoriteFood;
    indexes: { byNameKey: string; byCreatedAt: number };
  };
  [STORE_SHOPPING_LIST_META]: { key: string; value: ShoppingListMeta };
  [STORE_MICRONUTRIENT_PROFILES]: { key: string; value: MicronutrientProfile };
  [STORE_DELETIONS]: { key: string; value: DeletionRecord };
}

let dbPromise: Promise<IDBPDatabase<MacroDB>> | null = null;

function getDB(): Promise<IDBPDatabase<MacroDB>> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable on server"));
  }
  dbPromise ??= openDB<MacroDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      // v0 → v1: customFoods store.
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE_CUSTOM_FOODS, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("byName", "name", { unique: false });
      }
      // v1 → v2: profile + dailyLogs stores.
      if (oldVersion < 2) {
        db.createObjectStore(STORE_PROFILE, { keyPath: "_key" });
        db.createObjectStore(STORE_DAILY_LOGS, { keyPath: "date" });
      }
      // v2 → v3: mealTemplates store.
      if (oldVersion < 3) {
        db.createObjectStore(STORE_MEAL_TEMPLATES, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
      // v3 → v4: weightHistory store.
      if (oldVersion < 4) {
        db.createObjectStore(STORE_WEIGHT_HISTORY, { keyPath: "date" });
      }
      // v4 → v5: customFoods + mealTemplates switch to client-minted UUID
      // keys so the same row can exist in IndexedDB and Supabase under
      // identical ids. Drop the autoIncrement stores and recreate. Any
      // pre-existing local data is discarded - acceptable while we're
      // still in development; before shipping to real users, this would
      // need an in-place migration that rewrites keys.
      if (oldVersion < 5) {
        if (db.objectStoreNames.contains(STORE_CUSTOM_FOODS)) {
          db.deleteObjectStore(STORE_CUSTOM_FOODS);
        }
        const customFoods = db.createObjectStore(STORE_CUSTOM_FOODS, {
          keyPath: "id",
        });
        customFoods.createIndex("byName", "name", { unique: false });

        if (db.objectStoreNames.contains(STORE_MEAL_TEMPLATES)) {
          db.deleteObjectStore(STORE_MEAL_TEMPLATES);
        }
        db.createObjectStore(STORE_MEAL_TEMPLATES, { keyPath: "id" });
      }
      // v5 → v6: recipes store. New, additive - no existing data to migrate.
      if (oldVersion < 6) {
        const recipes = db.createObjectStore(STORE_RECIPES, { keyPath: "id" });
        recipes.createIndex("byName", "name", { unique: false });
      }
      // v6 → v7: add Versioned mixin fields to every existing row in
      // every synced store. Without this, the sync engine would
      // interpret every legacy row as "dirty" (serverUpdatedAt === null
      // / undefined) and try to UPDATE-with-version-check against a
      // null token - which would 0-row and look like a conflict.
      //
      // We mark legacy rows with `localUpdatedAt = nowIso()` and
      // `serverUpdatedAt = null`. The next sync will push them as
      // "new" rows (PK upsert wins anyway since the server-side row
      // already has the same id and a real `updated_at`). The pull
      // half then writes back the canonical server values, restoring
      // the steady-state invariant `localUpdatedAt === serverUpdatedAt`.
      if (oldVersion < 7) {
        // Use the *upgrade* transaction `idb` already passed us - we
        // must not open a new one inside the upgrade callback or the
        // versionchange tx will close before our cursors finish.
        const stores: ReadonlyArray<
          | typeof STORE_PROFILE
          | typeof STORE_DAILY_LOGS
          | typeof STORE_WEIGHT_HISTORY
          | typeof STORE_CUSTOM_FOODS
          | typeof STORE_MEAL_TEMPLATES
          | typeof STORE_RECIPES
        > = [
          STORE_PROFILE,
          STORE_DAILY_LOGS,
          STORE_WEIGHT_HISTORY,
          STORE_CUSTOM_FOODS,
          STORE_MEAL_TEMPLATES,
          STORE_RECIPES,
        ];
        for (const name of stores) {
          // The idb cursor-iteration pattern: `openCursor()` returns a
          // Promise resolving to a cursor; `cursor.continue()` returns
          // a Promise for the next cursor (or null). We need to await
          // sequentially inside the upgrade tx so the versionchange
          // transaction stays open through the loop.
          void (async () => {
            const store = transaction.objectStore(name);
            let cursor = await store.openCursor();
            while (cursor) {
              const value = cursor.value as Partial<Versioned>;
              if (
                value.localUpdatedAt == null ||
                value.serverUpdatedAt === undefined
              ) {
                await cursor.update({
                  ...cursor.value,
                  localUpdatedAt:
                    value.localUpdatedAt ?? new Date().toISOString(),
                  serverUpdatedAt: value.serverUpdatedAt ?? null,
                });
              }
              cursor = await cursor.continue();
            }
          })();
        }
      }
      // v7 → v8: deletion-tombstones store. Additive - no data to
      // migrate. The store starts empty; tombstones accumulate as
      // the user deletes rows after the upgrade.
      if (oldVersion < 8) {
        db.createObjectStore(STORE_DELETIONS, { keyPath: "_key" });
      }
      // v8 → v9: bodyMeasurements store. Additive - sister store
      // to weightHistory, same `date` keyPath. Used by the Progress
      // view's Body card (waist / neck / hips + body-fat estimate).
      if (oldVersion < 9) {
        db.createObjectStore(STORE_BODY_MEASUREMENTS, { keyPath: "date" });
      }
      // v9 → v10: pantryItems store. Additive - client-minted UUID
      // keyPath like recipes, with a byName index for the list view's
      // search. Starts empty.
      if (oldVersion < 10) {
        const store = db.createObjectStore(STORE_PANTRY_ITEMS, {
          keyPath: "id",
        });
        store.createIndex("byName", "name", { unique: false });
      }
      // v10 → v11: pantryNotifications store. Additive - client-minted
      // UUID keyPath, byCreatedAt index for newest-first drawer order.
      if (oldVersion < 11) {
        const store = db.createObjectStore(STORE_PANTRY_NOTIFICATIONS, {
          keyPath: "id",
        });
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
      // v11 → v12: favoriteStores store. Additive - the OSM key as
      // keyPath, byCreatedAt index for newest-first listing.
      if (oldVersion < 12) {
        const store = db.createObjectStore(STORE_FAVORITE_STORES, {
          keyPath: "id",
        });
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
      // v12 → v13: shoppingListMeta store. Additive — keyed on the
      // lowercased item name so the lookup map in ShoppingListView
      // (which lowercases for matching) hits without a re-key
      // step at read time.
      if (oldVersion < 13) {
        db.createObjectStore(STORE_SHOPPING_LIST_META, { keyPath: "name" });
      }
      // v13 → v14: micronutrientProfiles store. Additive — keyed on the
      // lowercased food name (`nameKey`) so a logged food joins to its
      // profile without a re-key, mirroring shoppingListMeta's keying.
      if (oldVersion < 14) {
        db.createObjectStore(STORE_MICRONUTRIENT_PROFILES, {
          keyPath: "nameKey",
        });
      }
      // v14 → v15: favoriteFoods store. Additive — UUID keyPath (shared
      // with Supabase) with a byNameKey index for "is this favourited?"
      // lookups and a byCreatedAt index for newest-first listing.
      if (oldVersion < 15) {
        const store = db.createObjectStore(STORE_FAVORITE_FOODS, {
          keyPath: "id",
        });
        store.createIndex("byNameKey", "nameKey", { unique: false });
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
      // v15 → v16: waterIntake store. Additive — keyed on the `YYYY-MM-DD`
      // date like weightHistory (one cumulative row per day).
      if (oldVersion < 16) {
        db.createObjectStore(STORE_WATER_INTAKE, { keyPath: "date" });
      }
    },
  });
  return dbPromise;
}

// ─── Custom foods ──────────────────────────────────────────────────────────

function mintId(): string {
  // crypto.randomUUID is available in secure contexts (https, localhost)
  // since 2022; this app is React 19 + Next 16 so it's always available.
  return crypto.randomUUID();
}

/** Insert a custom food. Mints a client-side UUID so the same id is
 *  shared with Supabase. New row → `serverUpdatedAt: null` until the
 *  next sync push acks it. */
export async function addCustomFood(
  food: Omit<CustomFood, "id" | "createdAt" | keyof Versioned>,
): Promise<string> {
  const db = await getDB();
  const id = mintId();
  await db.put(STORE_CUSTOM_FOODS, {
    ...food,
    id,
    createdAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: null,
  });
  return id;
}

/** Upsert a custom food at a specific id. Used by the edit flow to
 *  replace a row in place (preserves the existing server token so the
 *  push knows which version it branches from). The sync-layer
 *  equivalent for server-pulled rows is `applyServerCustomFood`. */
export async function upsertCustomFood(
  food: Omit<CustomFood, keyof Versioned> & Partial<Versioned>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_CUSTOM_FOODS, food.id);
  await db.put(STORE_CUSTOM_FOODS, {
    ...food,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: food.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
}

/** Sync-layer hook: write a server-pulled custom food. */
export async function applyServerCustomFood(
  food: Omit<CustomFood, keyof Versioned>,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_CUSTOM_FOODS, {
    ...food,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markCustomFoodSynced(
  id: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_CUSTOM_FOODS, id);
  if (!row) return;
  await db.put(STORE_CUSTOM_FOODS, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listCustomFoods(): Promise<CustomFood[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_CUSTOM_FOODS);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function searchCustomFoods(
  query: string,
  limit = 5,
): Promise<Food[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const all = await listCustomFoods();
  return all
    .filter((f) => f.name.toLowerCase().includes(trimmed))
    .slice(0, limit)
    .map(customToFood);
}

export async function deleteCustomFood(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_CUSTOM_FOODS, id);
  await recordDeletion("customFoods", id);
}

export function customToFood(c: CustomFood): Food {
  return {
    id: `custom:${c.id}`,
    source: "custom",
    name: c.name,
    protein: c.protein,
    carbs: c.carbs,
    fat: c.fat,
    calories: c.calories,
    category: c.category,
    subCategory: c.subCategory,
    brand: c.brand,
    // Optional macro-breakdown carried through so it surfaces in the
    // food-search result + the daily totals breakdown.
    sugars: c.sugars,
    addedSugars: c.addedSugars,
    fiber: c.fiber,
    saturatedFat: c.saturatedFat,
    transFat: c.transFat,
    monoFat: c.monoFat,
    polyFat: c.polyFat,
  };
}

// ─── Profile ───────────────────────────────────────────────────────────────

/** Read the single saved profile. Returns `null` if no profile has been
 * persisted yet (first run). Strips internal sync fields. */
export async function getProfile(): Promise<PersonalInfo | null> {
  const row = await getProfileRecord();
  if (!row) return null;
  const { localUpdatedAt: _local, serverUpdatedAt: _server, ...profile } = row;
  void _local;
  void _server;
  return profile;
}

/** Sync-layer hook: returns the profile row plus its Versioned fields
 *  so the sync engine can read `serverUpdatedAt` as the optimistic-
 *  concurrency token. Returns `null` for a never-saved profile. */
export async function getProfileRecord(): Promise<
  (PersonalInfo & Versioned) | null
> {
  const db = await getDB();
  const row = await db.get(STORE_PROFILE, PROFILE_KEY);
  if (!row) return null;
  const { _key: _ignored, ...rest } = row;
  void _ignored;
  return rest;
}

/** Save a profile from a user action. Bumps `localUpdatedAt`; the
 *  sync layer will detect this row as dirty and push it. Preserves the
 *  existing `serverUpdatedAt` token so the push knows which server
 *  version it's branching from. */
export async function saveProfile(profile: PersonalInfo): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_PROFILE, PROFILE_KEY);
  await db.put(STORE_PROFILE, {
    ...profile,
    _key: PROFILE_KEY,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: existing?.serverUpdatedAt ?? null,
    // Preserve the demo marker across edits so a user tweaking their
    // sample profile doesn't accidentally un-mark the dataset.
    ...(existing?._demoSeeded ? { _demoSeeded: true as const } : {}),
  });
}

/** Save a profile **and** mark it as demo-seeded in IDB. Used by the
 *  `?demo=1` seed routine so the demo signal lives in IDB (durable)
 *  rather than only in localStorage (can fail silently in private
 *  windows / quota-exceeded). Read back via `isProfileMarkedAsDemo`. */
export async function saveDemoProfile(profile: PersonalInfo): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_PROFILE, PROFILE_KEY);
  await db.put(STORE_PROFILE, {
    ...profile,
    _key: PROFILE_KEY,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: existing?.serverUpdatedAt ?? null,
    _demoSeeded: true,
  });
}

/** True when the locally-stored profile is marked as demo-seeded.
 *  Companion to the `DEMO_FLAG_KEY` localStorage signal — either being
 *  set means "this device's IDB contains demo data and the sign-in
 *  flow should wipe it before pushing anything to the server". */
export async function isProfileMarkedAsDemo(): Promise<boolean> {
  const db = await getDB();
  const row = await db.get(STORE_PROFILE, PROFILE_KEY);
  return row?._demoSeeded === true;
}

/** Wipe only the IDB stores the demo seed actually populates
 *  (`profile` / `dailyLogs` / `weightHistory`). Pantry items, recipes,
 *  custom foods, templates, favourites etc. the user added in guest
 *  mode are deliberately preserved — they aren't demo data. Used by
 *  `clearDemoModeData` before the first post-sign-in sync. */
export async function clearDemoSeededStores(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      STORE_PROFILE,
      STORE_DAILY_LOGS,
      STORE_WEIGHT_HISTORY,
      STORE_WATER_INTAKE,
      // shoppingListMeta is local-only-for-v1 but a guest user can
      // populate it during demo exploration (drag-to-reorder aisles,
      // notes, manual restocks). Without this clear it would survive
      // the demo→real transition and the user would see their demo
      // shopping-list preferences on their real account.
      STORE_SHOPPING_LIST_META,
    ],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore(STORE_PROFILE).clear(),
    tx.objectStore(STORE_DAILY_LOGS).clear(),
    tx.objectStore(STORE_WEIGHT_HISTORY).clear(),
    tx.objectStore(STORE_WATER_INTAKE).clear(),
    tx.objectStore(STORE_SHOPPING_LIST_META).clear(),
    tx.done,
  ]);
}

/** Sync-layer hook: write the profile we just pulled from the server.
 *  Sets both timestamps to the server's `updated_at` so the row reads
 *  as clean (localUpdatedAt === serverUpdatedAt) and won't be re-pushed. */
export async function applyServerProfile(
  profile: PersonalInfo,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_PROFILE, {
    ...profile,
    _key: PROFILE_KEY,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: after a successful push, refresh the local
 *  `serverUpdatedAt` to the value the server just stamped on us so
 *  future pushes carry the right concurrency token. The payload
 *  itself doesn't change; only the metadata. */
export async function markProfileSynced(
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_PROFILE, PROFILE_KEY);
  if (!row) return;
  await db.put(STORE_PROFILE, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

// ─── Daily logs ────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` for the given Date in the user's local timezone. */
export function dateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Convenience: today's local date key. */
export function todayKey(): string {
  return dateKey();
}

export async function getDailyLog(date: string): Promise<DailyLog | null> {
  const db = await getDB();
  const row = await db.get(STORE_DAILY_LOGS, date);
  return row ?? null;
}

export async function saveDailyLog(date: string, meals: Meal[]): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_DAILY_LOGS, date);
  const now = nowIso();
  await db.put(STORE_DAILY_LOGS, {
    date,
    meals,
    updatedAt: Date.now(),
    localUpdatedAt: now,
    serverUpdatedAt: existing?.serverUpdatedAt ?? null,
  });
  // Wake the data-bus so IDB-reading consumers (the fasting card + Topbar
  // chip, the streak chip, the Progress charts) refresh on a local log —
  // not only on a peer realtime arrival. `useDailyLog` reloads on this rev
  // too, but guards its own echo with a content compare, so no write loop.
  notifyDataChanged("dailyLogs");
}

/** All saved daily logs, newest first. Cheap because we only have one
 * record per day. */
export async function listDailyLogs(): Promise<DailyLog[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_DAILY_LOGS);
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function deleteDailyLog(date: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_DAILY_LOGS, date);
  await recordDeletion("dailyLogs", date);
}

/** Sync-layer hook: write a server-pulled daily log. Marks the row
 *  clean so it won't be re-pushed. Uses the server's `updated_at` as
 *  both the local and server token. */
export async function applyServerDailyLog(
  date: string,
  meals: Meal[],
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_DAILY_LOGS, {
    date,
    meals,
    updatedAt: Date.parse(serverUpdatedAt) || Date.now(),
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markDailyLogSynced(
  date: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_DAILY_LOGS, date);
  if (!row) return;
  await db.put(STORE_DAILY_LOGS, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

// ─── Meal templates ────────────────────────────────────────────────────────

/** Save a new meal template. Mints a client-side UUID. */
export async function saveMealTemplate(
  template: Omit<
    MealTemplate,
    "id" | "createdAt" | "updatedAt" | keyof Versioned
  >,
): Promise<string> {
  const db = await getDB();
  const now = Date.now();
  const id = mintId();
  await db.put(STORE_MEAL_TEMPLATES, {
    ...template,
    id,
    createdAt: now,
    updatedAt: now,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: null,
  });
  return id;
}

/** Upsert a template at a specific id. Used by the local edit flow and
 *  by the sync layer's UUID-collision recovery path. Preserves the
 *  caller-provided `serverUpdatedAt` if any (for sync-layer use); falls
 *  back to the existing row's token; ultimately null. */
export async function upsertMealTemplate(
  template: Omit<MealTemplate, keyof Versioned> & Partial<Versioned>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_MEAL_TEMPLATES, template.id);
  await db.put(STORE_MEAL_TEMPLATES, {
    ...template,
    localUpdatedAt: nowIso(),
    serverUpdatedAt:
      template.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
}

/** Sync-layer hook: write a server-pulled template. */
export async function applyServerMealTemplate(
  template: Omit<MealTemplate, keyof Versioned>,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_MEAL_TEMPLATES, {
    ...template,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markMealTemplateSynced(
  id: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_MEAL_TEMPLATES, id);
  if (!row) return;
  await db.put(STORE_MEAL_TEMPLATES, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listMealTemplates(): Promise<MealTemplate[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_MEAL_TEMPLATES);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteMealTemplate(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_MEAL_TEMPLATES, id);
  await recordDeletion("mealTemplates", id);
}

// ─── Weight history ────────────────────────────────────────────────────────

/** Record a weigh-in. Same-date saves overwrite, so multiple weigh-ins on
 * the same day collapse to the most recent value. Preserves the row's
 * existing `serverUpdatedAt` so the push knows the right base version. */
export async function saveWeightEntry(date: string, kg: number): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_WEIGHT_HISTORY, date);
  await db.put(STORE_WEIGHT_HISTORY, {
    date,
    kg,
    recordedAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: existing?.serverUpdatedAt ?? null,
  });
}

/** Sync-layer hook: write a server-pulled weight entry. */
export async function applyServerWeightEntry(
  date: string,
  kg: number,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_WEIGHT_HISTORY, {
    date,
    kg,
    recordedAt: Date.parse(serverUpdatedAt) || Date.now(),
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markWeightEntrySynced(
  date: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_WEIGHT_HISTORY, date);
  if (!row) return;
  await db.put(STORE_WEIGHT_HISTORY, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function getWeightEntry(
  date: string,
): Promise<WeightEntry | null> {
  const db = await getDB();
  const row = await db.get(STORE_WEIGHT_HISTORY, date);
  return row ?? null;
}

/** All weight entries, oldest first - the natural order for charts. */
export async function listWeightEntries(): Promise<WeightEntry[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_WEIGHT_HISTORY);
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function deleteWeightEntry(date: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_WEIGHT_HISTORY, date);
  await recordDeletion("weightHistory", date);
}

// ─── Water intake ──────────────────────────────────────────────────────────

/** Sane upper bound on a single day's logged water (20 L) so a fat-finger
 *  can't store an absurd total. */
const MAX_WATER_ML = 20000;

/** Add (or subtract, with a negative delta) water to a day's running total.
 *  Reads-then-adds — the one behavioural departure from `saveWeightEntry`'s
 *  overwrite — so every tap accumulates into the same date row. Clamps to
 *  [0, MAX_WATER_ML] and preserves the row's `serverUpdatedAt` so the push
 *  knows the right base version. */
export async function addWater(date: string, deltaMl: number): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_WATER_INTAKE, date);
  const ml = Math.max(
    0,
    Math.min(MAX_WATER_ML, Math.round((existing?.ml ?? 0) + deltaMl)),
  );
  await db.put(STORE_WATER_INTAKE, {
    date,
    ml,
    recordedAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: existing?.serverUpdatedAt ?? null,
  });
  notifyDataChanged("waterIntake");
}

/** Set a day's water total to an absolute value (the inline "edit total"
 *  affordance), as opposed to `addWater`'s relative delta. */
export async function setWaterTotal(date: string, ml: number): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_WATER_INTAKE, date);
  await db.put(STORE_WATER_INTAKE, {
    date,
    ml: Math.max(0, Math.min(MAX_WATER_ML, Math.round(ml))),
    recordedAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: existing?.serverUpdatedAt ?? null,
  });
  notifyDataChanged("waterIntake");
}

/** Sync-layer hook: write a server-pulled water row. */
export async function applyServerWaterIntake(
  date: string,
  ml: number,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_WATER_INTAKE, {
    date,
    ml,
    recordedAt: Date.parse(serverUpdatedAt) || Date.now(),
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markWaterIntakeSynced(
  date: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_WATER_INTAKE, date);
  if (!row) return;
  await db.put(STORE_WATER_INTAKE, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function getWaterIntake(
  date: string,
): Promise<WaterIntake | null> {
  const db = await getDB();
  const row = await db.get(STORE_WATER_INTAKE, date);
  return row ?? null;
}

/** All water rows, oldest first — the natural order for charts. */
export async function listWaterIntake(): Promise<WaterIntake[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_WATER_INTAKE);
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ─── Body measurements ─────────────────────────────────────────────────────

/** Record a measurement set on `date`. Same-date saves overwrite the
 *  prior row so the latest write per day wins, matching weight
 *  history. Pass `undefined` for fields the user didn't measure; they
 *  remain absent on the row (not zero-coerced, since "0 cm" is a
 *  meaningful nonsense distinct from "didn't measure today"). */
export async function saveBodyMeasurement(
  date: string,
  values: Pick<BodyMeasurement, "waistCm" | "neckCm" | "hipsCm" | "notes">,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_BODY_MEASUREMENTS, date);
  await db.put(STORE_BODY_MEASUREMENTS, {
    date,
    waistCm: values.waistCm,
    neckCm: values.neckCm,
    hipsCm: values.hipsCm,
    notes: values.notes,
    recordedAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: existing?.serverUpdatedAt ?? null,
  });
}

/** All body measurements, oldest first - chart-natural order. */
export async function listBodyMeasurements(): Promise<BodyMeasurement[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_BODY_MEASUREMENTS);
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function getBodyMeasurement(
  date: string,
): Promise<BodyMeasurement | null> {
  const db = await getDB();
  const row = await db.get(STORE_BODY_MEASUREMENTS, date);
  return row ?? null;
}

export async function deleteBodyMeasurement(date: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_BODY_MEASUREMENTS, date);
  await recordDeletion("bodyMeasurements", date);
}

/** Sync-layer hook: write a server-pulled measurement. Mirrors
 *  `applyServerWeightEntry`. */
export async function applyServerBodyMeasurement(
  date: string,
  values: Pick<BodyMeasurement, "waistCm" | "neckCm" | "hipsCm" | "notes">,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_BODY_MEASUREMENTS, {
    date,
    waistCm: values.waistCm,
    neckCm: values.neckCm,
    hipsCm: values.hipsCm,
    notes: values.notes,
    recordedAt: Date.parse(serverUpdatedAt) || Date.now(),
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful
 *  push. */
export async function markBodyMeasurementSynced(
  date: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_BODY_MEASUREMENTS, date);
  if (!row) return;
  await db.put(STORE_BODY_MEASUREMENTS, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

// ─── Recipes ───────────────────────────────────────────────────────────────

/** Save a new recipe. Mints a client-side UUID so the same id is shared
 *  with Supabase (mirrors meal templates). */
export async function addRecipe(
  recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const db = await getDB();
  const now = Date.now();
  const id = mintId();
  await db.put(STORE_RECIPES, {
    ...recipe,
    id,
    createdAt: now,
    updatedAt: now,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: null,
  });
  return id;
}

/** Upsert a recipe at a specific id. Used by the edit flow and the
 *  sync layer's UUID-collision recovery path. Preserves the
 *  caller-provided `serverUpdatedAt` for sync-layer use; falls back to
 *  the existing row's token; ultimately null. */
export async function upsertRecipe(
  recipe: Recipe & Partial<Versioned>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_RECIPES, recipe.id);
  await db.put(STORE_RECIPES, {
    ...recipe,
    localUpdatedAt: nowIso(),
    serverUpdatedAt:
      recipe.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
}

/** Sync-layer hook: write a server-pulled recipe. */
export async function applyServerRecipe(
  recipe: Recipe,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_RECIPES, {
    ...recipe,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markRecipeSynced(
  id: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_RECIPES, id);
  if (!row) return;
  await db.put(STORE_RECIPES, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listRecipes(): Promise<
  Array<Recipe & Versioned & Sortable>
> {
  const db = await getDB();
  const rows = await db.getAll(STORE_RECIPES);
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteRecipe(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_RECIPES, id);
  await recordDeletion("recipes", id);
}

// ─── Pantry items ──────────────────────────────────────────────────────────

/** Save a new pantry item. Mints a client-side UUID shared with
 *  Supabase, same as recipes / custom foods. */
export async function addPantryItem(
  item: Omit<PantryItem, "id" | "createdAt" | "updatedAt" | keyof Versioned>,
): Promise<string> {
  const db = await getDB();
  const now = Date.now();
  const id = mintId();
  await db.put(STORE_PANTRY_ITEMS, {
    ...item,
    id,
    createdAt: now,
    updatedAt: now,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: null,
  });
  notifyDataChanged("pantryItems");
  return id;
}

/** Upsert a pantry item at a specific id. Used by the edit flow and
 *  the sync layer's UUID-collision recovery path. Bumps `updatedAt`
 *  + `localUpdatedAt` so the row is marked dirty; preserves the
 *  caller-provided `serverUpdatedAt`, falling back to the existing
 *  row's token, then null. */
export async function upsertPantryItem(
  item: PantryItem & Partial<Versioned>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_PANTRY_ITEMS, item.id);
  await db.put(STORE_PANTRY_ITEMS, {
    ...item,
    updatedAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: item.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
  notifyDataChanged("pantryItems");
}

/** Sync-layer hook: write a server-pulled pantry item. */
export async function applyServerPantryItem(
  item: PantryItem,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_PANTRY_ITEMS, {
    ...item,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markPantryItemSynced(
  id: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_PANTRY_ITEMS, id);
  if (!row) return;
  await db.put(STORE_PANTRY_ITEMS, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listPantryItems(): Promise<PantryItem[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_PANTRY_ITEMS);
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePantryItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_PANTRY_ITEMS, id);
  await recordDeletion("pantryItems", id);
  notifyDataChanged("pantryItems");
}

// ─── Pantry notifications ────────────────────────────────────────────────────

/** Create a notification. Mints a client-side UUID shared with
 *  Supabase, same as the other synced stores. */
export async function addPantryNotification(
  notif: Omit<
    PantryNotification,
    "id" | "createdAt" | "updatedAt" | keyof Versioned
  >,
): Promise<string> {
  const db = await getDB();
  const now = Date.now();
  const id = mintId();
  await db.put(STORE_PANTRY_NOTIFICATIONS, {
    ...notif,
    id,
    createdAt: now,
    updatedAt: now,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: null,
  });
  notifyDataChanged("pantryNotifications");
  return id;
}

/** Upsert at a specific id — used by the read-toggle flow and the
 *  sync layer's UUID-collision recovery. Bumps `updatedAt` +
 *  `localUpdatedAt` so the row is dirty; preserves the caller's
 *  `serverUpdatedAt`, then the existing row's, then null. */
export async function upsertPantryNotification(
  notif: PantryNotification & Partial<Versioned>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_PANTRY_NOTIFICATIONS, notif.id);
  await db.put(STORE_PANTRY_NOTIFICATIONS, {
    ...notif,
    updatedAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: notif.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
  notifyDataChanged("pantryNotifications");
}

/** Mark a notification read (or unread). No-op when the id is gone. */
export async function setPantryNotificationRead(
  id: string,
  read: boolean,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_PANTRY_NOTIFICATIONS, id);
  if (!row) return;
  await upsertPantryNotification({ ...row, read });
}

/** Sync-layer hook: write a server-pulled notification. */
export async function applyServerPantryNotification(
  notif: PantryNotification,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_PANTRY_NOTIFICATIONS, {
    ...notif,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markPantryNotificationSynced(
  id: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_PANTRY_NOTIFICATIONS, id);
  if (!row) return;
  await db.put(STORE_PANTRY_NOTIFICATIONS, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listPantryNotifications(): Promise<PantryNotification[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_PANTRY_NOTIFICATIONS);
  // Newest first for the drawer.
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deletePantryNotification(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_PANTRY_NOTIFICATIONS, id);
  await recordDeletion("pantryNotifications", id);
  notifyDataChanged("pantryNotifications");
}

// ─── Favourite stores ────────────────────────────────────────────────────────

/** Upsert a favourite store at its OSM id. Used by the star toggle and
 *  the sync layer. Bumps `updatedAt` + `localUpdatedAt` so the row is
 *  dirty; preserves `createdAt` from the existing row (first star) and
 *  the caller's / existing `serverUpdatedAt`, then null. */
export async function upsertFavoriteStore(
  store: Omit<FavoriteStore, "createdAt" | "updatedAt" | keyof Versioned> &
    Partial<FavoriteStore>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_FAVORITE_STORES, store.id);
  const now = Date.now();
  await db.put(STORE_FAVORITE_STORES, {
    ...store,
    createdAt: existing?.createdAt ?? store.createdAt ?? now,
    updatedAt: now,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: store.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
  notifyDataChanged("favoriteStores");
}

/** Sync-layer hook: write a server-pulled favourite store. */
export async function applyServerFavoriteStore(
  store: FavoriteStore,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_FAVORITE_STORES, {
    ...store,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markFavoriteStoreSynced(
  id: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_FAVORITE_STORES, id);
  if (!row) return;
  await db.put(STORE_FAVORITE_STORES, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listFavoriteStores(): Promise<FavoriteStore[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_FAVORITE_STORES);
  // Newest-favourited first.
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteFavoriteStore(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_FAVORITE_STORES, id);
  await recordDeletion("favoriteStores", id);
  notifyDataChanged("favoriteStores");
}

// ─── Favourite foods ─────────────────────────────────────────────────────────

function favoriteKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Pin a food as a favourite. Mints a UUID shared with Supabase; stores
 *  the addable per-100g `food` + default `portion` inline. No-op (returns
 *  the existing id) if the food is already favourited, so the star toggle
 *  can't create duplicates. */
export async function addFavoriteFood(
  food: Food,
  portion: number,
): Promise<string> {
  const db = await getDB();
  const nameKey = favoriteKey(food.name);
  const existing = await db.getFromIndex(
    STORE_FAVORITE_FOODS,
    "byNameKey",
    nameKey,
  );
  if (existing) return existing.id;
  const id = mintId();
  await db.put(STORE_FAVORITE_FOODS, {
    id,
    nameKey,
    food,
    portion: Math.max(1, Math.round(portion)),
    createdAt: Date.now(),
    localUpdatedAt: nowIso(),
    serverUpdatedAt: null,
  });
  notifyDataChanged("favoriteFoods");
  return id;
}

/** Upsert a favourite at a specific id (sync edit flow). */
export async function upsertFavoriteFood(
  fav: Omit<FavoriteFood, keyof Versioned> & Partial<Versioned>,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_FAVORITE_FOODS, fav.id);
  await db.put(STORE_FAVORITE_FOODS, {
    ...fav,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: fav.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
  notifyDataChanged("favoriteFoods");
}

/** Sync-layer hook: write a server-pulled favourite food. */
export async function applyServerFavoriteFood(
  fav: Omit<FavoriteFood, keyof Versioned>,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_FAVORITE_FOODS, {
    ...fav,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markFavoriteFoodSynced(
  id: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_FAVORITE_FOODS, id);
  if (!row) return;
  await db.put(STORE_FAVORITE_FOODS, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listFavoriteFoods(): Promise<FavoriteFood[]> {
  const db = await getDB();
  const rows = await db.getAll(STORE_FAVORITE_FOODS);
  // Newest-favourited first.
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** Un-favourite a food by name (the star toggle's off path). Records a
 *  tombstone per removed row so the deletion syncs. */
export async function deleteFavoriteFoodByName(name: string): Promise<void> {
  const db = await getDB();
  const matches = await db.getAllFromIndex(
    STORE_FAVORITE_FOODS,
    "byNameKey",
    favoriteKey(name),
  );
  if (matches.length === 0) return;
  const tx = db.transaction(STORE_FAVORITE_FOODS, "readwrite");
  await Promise.all([...matches.map((m) => tx.store.delete(m.id)), tx.done]);
  for (const m of matches) await recordDeletion("favoriteFoods", m.id);
  notifyDataChanged("favoriteFoods");
}

// ─── Micronutrient profiles (derived enrichment cache) ───────────────────

/** Upsert a micronutrient profile at its `nameKey`. Written by the
 *  sync layer (the cron-derived server rows) and, in principle, by a
 *  future client-side enrichment. Bumps the version token so the row
 *  is dirty; preserves any existing `serverUpdatedAt` then null. */
export async function saveMicronutrientProfile(
  profile: MicronutrientProfile,
): Promise<void> {
  const db = await getDB();
  const existing = await db.get(STORE_MICRONUTRIENT_PROFILES, profile.nameKey);
  await db.put(STORE_MICRONUTRIENT_PROFILES, {
    ...profile,
    localUpdatedAt: nowIso(),
    serverUpdatedAt:
      profile.serverUpdatedAt ?? existing?.serverUpdatedAt ?? null,
  });
  notifyDataChanged("micronutrientProfiles");
}

/** Sync-layer hook: write a server-pulled profile. */
export async function applyServerMicronutrientProfile(
  profile: MicronutrientProfile,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_MICRONUTRIENT_PROFILES, {
    ...profile,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

/** Sync-layer hook: refresh the version token after a successful push. */
export async function markMicronutrientProfileSynced(
  nameKey: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(STORE_MICRONUTRIENT_PROFILES, nameKey);
  if (!row) return;
  await db.put(STORE_MICRONUTRIENT_PROFILES, {
    ...row,
    localUpdatedAt: serverUpdatedAt,
    serverUpdatedAt,
  });
}

export async function listMicronutrientProfiles(): Promise<
  MicronutrientProfile[]
> {
  const db = await getDB();
  return db.getAll(STORE_MICRONUTRIENT_PROFILES);
}

// ─── Shopping-list meta (per-item user overrides) ────────────────────────

/** Build the storage key for an item name — lowercased + trimmed
 *  whitespace. Keep ALL writes and reads going through this so
 *  "Olive Oil" and "olive oil " hit the same row. */
function shoppingListMetaKey(name: string): string {
  return name.toLowerCase().trim();
}

/** Read every per-item override. Cheap (~tens of rows for active
 *  shoppers); ShoppingListView turns the array into a Map for
 *  per-render lookups. */
export async function listShoppingListMeta(): Promise<ShoppingListMeta[]> {
  const db = await getDB();
  return db.getAll(STORE_SHOPPING_LIST_META);
}

/** Insert or update an override row. The caller passes the *original*
 *  item name and a partial patch — any field not present in the
 *  patch is preserved from the existing row, and an explicit `null`
 *  CLEARS the field (so e.g. `extraQty: null` removes the manual
 *  add-to-shopping-list flag without disturbing notes or category). */
export async function upsertShoppingListMeta(
  name: string,
  patch: {
    category?: ShoppingAisle | null;
    notes?: string | null;
    extraQty?: number | null;
    extraUnit?: string | null;
    qtyOverride?: number | null;
    appearancesOverride?: number | null;
    excluded?: boolean | null;
  },
): Promise<void> {
  const db = await getDB();
  const key = shoppingListMetaKey(name);
  const existing = await db.get(STORE_SHOPPING_LIST_META, key);
  const merge = <T>(
    p: T | null | undefined,
    e: T | undefined,
  ): T | undefined => (p === null ? undefined : (p ?? e));
  await db.put(STORE_SHOPPING_LIST_META, {
    name: key,
    category: merge(patch.category, existing?.category),
    notes: merge(patch.notes, existing?.notes),
    extraQty: merge(patch.extraQty, existing?.extraQty),
    extraUnit: merge(patch.extraUnit, existing?.extraUnit),
    qtyOverride: merge(patch.qtyOverride, existing?.qtyOverride),
    appearancesOverride: merge(
      patch.appearancesOverride,
      existing?.appearancesOverride,
    ),
    excluded: merge(patch.excluded, existing?.excluded),
    updatedAt: Date.now(),
  });
  notifyDataChanged("shoppingListMeta");
}

/** Drop the user's override entirely (used by a future "reset to
 *  default" affordance — kept in the API now so the store has the
 *  symmetric add/remove pair). */
export async function deleteShoppingListMeta(name: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_SHOPPING_LIST_META, shoppingListMetaKey(name));
  notifyDataChanged("shoppingListMeta");
}

// ─── Sort order (custom drag-and-drop) ────────────────────────────────────

/** The three list-table stores that support the "custom" sort mode in
 *  the UI (My Foods, Recipes, Templates). Other stores either have
 *  intrinsic ordering (daily logs, weights - by date) or are
 *  single-row (profile). */
export type SortableStoreName =
  | typeof STORE_CUSTOM_FOODS
  | typeof STORE_RECIPES
  | typeof STORE_MEAL_TEMPLATES;

/** Set a row's manual `sortOrder` after a drag-and-drop. Pure number
 *  write: the rest of the row stays as-is. Marks the row dirty via the
 *  same `localUpdatedAt` bump every saver does, so the next sync push
 *  carries the change. */
export async function setSortOrder(
  store: SortableStoreName,
  id: string,
  sortOrder: number,
): Promise<void> {
  const db = await getDB();
  const row = await db.get(store, id);
  if (!row) return;
  await db.put(store, {
    ...row,
    sortOrder,
    localUpdatedAt: nowIso(),
    serverUpdatedAt: row.serverUpdatedAt ?? null,
  });
}

/** Compute a fractional sort key that sits between `prev` and `next`.
 *  Either neighbor can be `null` (end of list). The returned number
 *  is the midpoint of two reals when both neighbors exist - the
 *  classic fractional-indexing trick that avoids the renumber cascade
 *  a plain integer position would require.
 *
 *  Exported for tests; also used by the drag-end handlers. */
export function computeSortBetween(
  prev: number | null | undefined,
  next: number | null | undefined,
): number {
  const a = prev ?? null;
  const b = next ?? null;
  if (a == null && b == null) return Date.now();
  if (a == null) return (b as number) - 1;
  if (b == null) return (a as number) + 1;
  return (a + b) / 2;
}

// ─── Deletion tombstones ──────────────────────────────────────────────────

/** Record that the user wants `rowKey` in `storeName` deleted. The
 *  sync engine drains the tombstone store on every push, issuing the
 *  matching `supabase.from(table).delete().eq(...)` and removing the
 *  tombstone on success. Each deleteX function in this module calls
 *  this, so the delete propagates without the consumer needing to
 *  know anything about sync. */
async function recordDeletion(
  storeName: DeletableStore,
  rowKey: string,
): Promise<void> {
  const db = await getDB();
  const key = `${storeName}:${rowKey}`;
  await db.put(STORE_DELETIONS, {
    _key: key,
    storeName,
    rowKey,
    deletedAt: Date.now(),
  });
}

/** Sync-layer hook: every pending deletion. */
export async function listDeletions(): Promise<DeletionRecord[]> {
  const db = await getDB();
  return db.getAll(STORE_DELETIONS);
}

/** Sync-layer hook: drop a tombstone after the server-side delete
 *  succeeded. Safe to call on a key that doesn't exist. */
export async function clearDeletion(
  storeName: DeletableStore,
  rowKey: string,
): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_DELETIONS, `${storeName}:${rowKey}`);
}

/** Realtime echo + initial-sync interaction: if a peer device deleted
 *  a row we *also* have a tombstone for, the tombstone is now
 *  redundant - both sides agree the row is gone. Clear it so we don't
 *  re-send the delete. Same shape as `clearDeletion`; named separately
 *  to make the call sites in the sync engine read clearly. */
export async function clearTombstoneIfPresent(
  storeName: DeletableStore,
  rowKey: string,
): Promise<void> {
  await clearDeletion(storeName, rowKey);
}

/** Silent local-only delete used by the realtime DELETE handler (and
 *  the sync pull when we discover a row is gone server-side). Removes
 *  the IDB row WITHOUT writing a tombstone - we'd otherwise echo a
 *  redundant DELETE back to the server. Also wipes any pre-existing
 *  tombstone for the same key, since the server has already confirmed
 *  the row's deletion. */
export async function applyServerDeletion(
  storeName: DeletableStore,
  rowKey: string,
): Promise<void> {
  const db = await getDB();
  const storeMap: Record<DeletableStore, string> = {
    customFoods: STORE_CUSTOM_FOODS,
    mealTemplates: STORE_MEAL_TEMPLATES,
    recipes: STORE_RECIPES,
    dailyLogs: STORE_DAILY_LOGS,
    weightHistory: STORE_WEIGHT_HISTORY,
    bodyMeasurements: STORE_BODY_MEASUREMENTS,
    pantryItems: STORE_PANTRY_ITEMS,
    pantryNotifications: STORE_PANTRY_NOTIFICATIONS,
    favoriteStores: STORE_FAVORITE_STORES,
    favoriteFoods: STORE_FAVORITE_FOODS,
  };
  await db.delete(
    storeMap[storeName] as
      | typeof STORE_CUSTOM_FOODS
      | typeof STORE_MEAL_TEMPLATES
      | typeof STORE_RECIPES
      | typeof STORE_DAILY_LOGS
      | typeof STORE_WEIGHT_HISTORY
      | typeof STORE_PANTRY_ITEMS
      | typeof STORE_PANTRY_NOTIFICATIONS
      | typeof STORE_FAVORITE_STORES
      | typeof STORE_FAVORITE_FOODS,
    rowKey,
  );
  await clearTombstoneIfPresent(storeName, rowKey);
}

// ─── Bulk ──────────────────────────────────────────────────────────────────

/** Wipes every store. Used by the Delete account flow so a future sign-in
 * on the same device starts from a truly empty slate (otherwise the next
 * sync would push the leftover rows into the new user's account). Runs
 * in a single transaction so a mid-flight failure either clears all
 * stores or none - no half-state. */
export async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      STORE_CUSTOM_FOODS,
      STORE_PROFILE,
      STORE_DAILY_LOGS,
      STORE_MEAL_TEMPLATES,
      STORE_WEIGHT_HISTORY,
      STORE_WATER_INTAKE,
      STORE_BODY_MEASUREMENTS,
      STORE_RECIPES,
      STORE_PANTRY_ITEMS,
      STORE_PANTRY_NOTIFICATIONS,
      STORE_FAVORITE_STORES,
      STORE_FAVORITE_FOODS,
      STORE_SHOPPING_LIST_META,
      STORE_MICRONUTRIENT_PROFILES,
      STORE_DELETIONS,
    ],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore(STORE_CUSTOM_FOODS).clear(),
    tx.objectStore(STORE_PROFILE).clear(),
    tx.objectStore(STORE_DAILY_LOGS).clear(),
    tx.objectStore(STORE_MEAL_TEMPLATES).clear(),
    tx.objectStore(STORE_WEIGHT_HISTORY).clear(),
    tx.objectStore(STORE_WATER_INTAKE).clear(),
    tx.objectStore(STORE_BODY_MEASUREMENTS).clear(),
    tx.objectStore(STORE_RECIPES).clear(),
    tx.objectStore(STORE_PANTRY_ITEMS).clear(),
    tx.objectStore(STORE_PANTRY_NOTIFICATIONS).clear(),
    tx.objectStore(STORE_FAVORITE_STORES).clear(),
    tx.objectStore(STORE_FAVORITE_FOODS).clear(),
    tx.objectStore(STORE_SHOPPING_LIST_META).clear(),
    tx.objectStore(STORE_MICRONUTRIENT_PROFILES).clear(),
    tx.objectStore(STORE_DELETIONS).clear(),
    tx.done,
  ]);
}
