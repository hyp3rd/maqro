"use client";

import {
  applyServerCustomFood,
  applyServerDailyLog,
  applyServerFavoriteFood,
  applyServerFavoriteStore,
  applyServerMealTemplate,
  applyServerMicronutrientProfile,
  applyServerPantryItem,
  applyServerPantryNotification,
  applyServerProfile,
  applyServerRecipe,
  applyServerSupplementIntake,
  applyServerWaterIntake,
  applyServerWeightEntry,
  applyServerDeletion,
  type DeletableStore,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import { notifyDataChanged } from "./data-bus";
import {
  customFoodFromRow,
  dailyLogFromRow,
  favoriteFoodFromRow,
  favoriteStoreFromRow,
  mealTemplateFromRow,
  micronutrientProfileFromRow,
  pantryItemFromRow,
  pantryNotificationFromRow,
  profileFromRow,
  recipeFromRow,
  supplementIntakeFromRow,
  waterFromRow,
  weightFromRow,
  type CustomFoodRow,
  type DailyLogRow,
  type FavoriteFoodRow,
  type FavoriteStoreRow,
  type MealTemplateRow,
  type MicronutrientProfileRow,
  type PantryItemRow,
  type PantryNotificationRow,
  type ProfileRow,
  type RecipeRow,
  type SupplementIntakeRow,
  type WaterRow,
  type WeightRow,
} from "./mappers";

/** Handle returned by `startRealtimeSubscription`. Caller (SyncManager)
 *  invokes `unsubscribe()` on sign-out so the channels release. */
export type RealtimeHandle = { unsubscribe: () => void };

/** Optional callback invoked when the realtime layer detects it
 *  reconnected after a disconnect — caller (SyncManager) should run
 *  a one-shot `runInitialSync` to catch up on events that fired
 *  during the gap. Wired separately so realtime.ts stays decoupled
 *  from sync/index.ts (avoiding a circular import). */
export type RealtimeCallbacks = { onReconnect?: () => void };

/** Subscribe to Postgres change events on every synced table, filtered
 *  to the calling user's rows via the standard
 *  `user_id=eq.<userId>` Realtime filter. On each `INSERT` / `UPDATE`,
 *  offer the new row to IDB via the matching `applyServerX` helper (which
 *  never overwrites a dirty local edit) and, when it was written, notify
 *  the data bus so React hooks re-fetch. On `DELETE`, remove the local
 *  copy via `applyServerDeletion` (owner-checked, dirty rows kept).
 *
 *  Channels are owned by this module — the returned handle's
 *  `unsubscribe()` is the only public lifecycle hook. */
export function startRealtimeSubscription(
  supabase: SupabaseClient,
  userId: string,
  callbacks: RealtimeCallbacks = {},
): RealtimeHandle {
  const filter = `user_id=eq.${userId}`;
  const channels: RealtimeChannel[] = [];

  // Wrap the SUBSCRIBE callback so the first transition from
  // SUBSCRIBED → CLOSED → SUBSCRIBED (a reconnect after a network
  // blip) fires `onReconnect`. The initial SUBSCRIBED isn't a
  // reconnect, so we only flip the flag after we've been closed.
  function buildSubscribeHandler(): (status: string) => void {
    let wasClosed = false;
    return (status) => {
      if (status === "CLOSED" || status === "CHANNEL_ERROR") {
        wasClosed = true;
        return;
      }
      if (status === "SUBSCRIBED" && wasClosed) {
        wasClosed = false;
        callbacks.onReconnect?.();
      }
    };
  }

  channels.push(
    supabase
      .channel("sync-profile")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter },
        run(userId, handleProfile),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-daily-logs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_logs", filter },
        run(userId, handleDailyLog),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-weight-history")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weight_history", filter },
        run(userId, handleWeight),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-water-intake")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "water_intake", filter },
        run(userId, handleWater),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-supplement-intake")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supplement_intake", filter },
        run(userId, handleSupplementIntake),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-custom-foods")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "custom_foods", filter },
        run(userId, handleCustomFood),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-meal-templates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meal_templates", filter },
        run(userId, handleMealTemplate),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-recipes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "recipes", filter },
        run(userId, handleRecipe),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-pantry-items")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pantry_items", filter },
        run(userId, handlePantryItem),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-pantry-notifications")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pantry_notifications", filter },
        run(userId, handlePantryNotification),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-favorite-stores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "favorite_stores", filter },
        run(userId, handleFavoriteStore),
      )
      .subscribe(buildSubscribeHandler()),
  );
  channels.push(
    supabase
      .channel("sync-favorite-foods")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "favorite_foods", filter },
        run(userId, handleFavoriteFood),
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-micronutrient-profiles")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "micronutrient_profiles",
          filter,
        },
        run(userId, handleMicronutrientProfile),
      )
      .subscribe(buildSubscribeHandler()),
  );

  return {
    unsubscribe: () => {
      for (const ch of channels) {
        // removeChannel handles both leave and cleanup; returns a
        // Promise we don't await — caller is unmounting.
        void supabase.removeChannel(ch);
      }
    },
  };
}

// ─── Per-table handlers ──────────────────────────────────────────────

/** Supabase's `.on("postgres_changes", …)` callback always types the
 *  payload generically as `{ [key: string]: any }` — the typed `Row`
 *  generic on the callback isn't propagated. We cast inside each
 *  handler. */
type LoosePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

/** Wrap an async payload handler for `.on(...)`: a failed IDB apply (quota,
 *  private-mode eviction, closed connection) surfaces through the
 *  storage-health banner via `reportStorageError` instead of vanishing as an
 *  unhandled rejection — a silently dropped cross-device change is exactly
 *  the failure that banner exists for. */
function run(
  userId: string,
  handler: (payload: LoosePayload, userId: string) => Promise<void>,
) {
  return (payload: LoosePayload) => {
    handler(payload, userId).catch(reportStorageError);
  };
}

/** Helper: pull a typed `new` payload out of a postgres_changes event,
 *  guarding against partial rows (Realtime sometimes sends only PK
 *  data on DELETE, or `{}` on UPDATEs when REPLICA IDENTITY isn't
 *  FULL on the source table). Returns the cast row or null. */
function newRow<R>(payload: LoosePayload): R | null {
  if (payload.eventType === "DELETE") return null;
  const n = payload.new as Record<string, unknown> | undefined;
  if (!n || Object.keys(n).length === 0) return null;
  return n as unknown as R;
}

async function handleProfile(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    // Profile deletion = account deletion. The Delete-account flow
    // already wipes local stores; no per-row delete needed here.
    notifyDataChanged("profile");
    return;
  }
  const row = newRow<ProfileRow>(payload);
  if (!row) return;
  // `{}` placeholder (migration 0074): no profile yet — keep the local one.
  const profile = profileFromRow(row);
  if (!profile) return;
  if ((await applyServerProfile(profile, row.updated_at)) === "applied") {
    notifyDataChanged("profile");
  }
}

async function handleDailyLog(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "dailyLogs", "date");
    return;
  }
  const row = newRow<DailyLogRow>(payload);
  if (!row) return;
  const log = dailyLogFromRow(row);
  if (
    (await applyServerDailyLog(log.date, log.meals, row.updated_at)) ===
    "applied"
  ) {
    notifyDataChanged("dailyLogs");
  }
}

async function handleWeight(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "weightHistory", "date");
    return;
  }
  const row = newRow<WeightRow>(payload);
  if (!row) return;
  const entry = weightFromRow(row);
  if (
    (await applyServerWeightEntry(entry.date, entry.kg, row.updated_at)) ===
    "applied"
  ) {
    notifyDataChanged("weightHistory");
  }
}

async function handleWater(payload: LoosePayload) {
  // No DELETE path: water is add/adjust-only, never user-deleted. A
  // server-side DELETE (account cascade) is harmless — the row gets
  // wiped on sign-out's clearAllStores — so we ignore DELETE and only
  // apply upserts (mirroring handleMicronutrientProfile).
  if (payload.eventType === "DELETE") return;
  const row = newRow<WaterRow>(payload);
  if (!row) return;
  const entry = waterFromRow(row);
  if (
    (await applyServerWaterIntake(entry.date, entry.ml, row.updated_at)) ===
    "applied"
  ) {
    notifyDataChanged("waterIntake");
  }
}

async function handleSupplementIntake(payload: LoosePayload) {
  // Like water: date-keyed, upsert-only — ignore server DELETE (handled by
  // clearAllStores on sign-out).
  if (payload.eventType === "DELETE") return;
  const row = newRow<SupplementIntakeRow>(payload);
  if (!row) return;
  const entry = supplementIntakeFromRow(row);
  if (
    (await applyServerSupplementIntake(
      entry.date,
      entry.taken,
      row.updated_at,
    )) === "applied"
  ) {
    notifyDataChanged("supplementIntake");
  }
}

async function handleCustomFood(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "customFoods", "id");
    return;
  }
  const row = newRow<CustomFoodRow>(payload);
  if (!row) return;
  if (
    (await applyServerCustomFood(customFoodFromRow(row), row.updated_at)) ===
    "applied"
  ) {
    notifyDataChanged("customFoods");
  }
}

async function handleMealTemplate(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "mealTemplates", "id");
    return;
  }
  const row = newRow<MealTemplateRow>(payload);
  if (!row) return;
  if (
    (await applyServerMealTemplate(
      mealTemplateFromRow(row),
      row.updated_at,
    )) === "applied"
  ) {
    notifyDataChanged("mealTemplates");
  }
}

async function handleRecipe(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "recipes", "id");
    return;
  }
  const row = newRow<RecipeRow>(payload);
  if (!row) return;
  if (
    (await applyServerRecipe(recipeFromRow(row), row.updated_at)) === "applied"
  ) {
    notifyDataChanged("recipes");
  }
}

async function handlePantryItem(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "pantryItems", "id");
    return;
  }
  const row = newRow<PantryItemRow>(payload);
  if (!row) return;
  if (
    (await applyServerPantryItem(pantryItemFromRow(row), row.updated_at)) ===
    "applied"
  ) {
    notifyDataChanged("pantryItems");
  }
}

async function handlePantryNotification(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "pantryNotifications", "id");
    return;
  }
  const row = newRow<PantryNotificationRow>(payload);
  if (!row) return;
  if (
    (await applyServerPantryNotification(
      pantryNotificationFromRow(row),
      row.updated_at,
    )) === "applied"
  ) {
    notifyDataChanged("pantryNotifications");
  }
}

async function handleFavoriteStore(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "favoriteStores", "id");
    return;
  }
  const row = newRow<FavoriteStoreRow>(payload);
  if (!row) return;
  if (
    (await applyServerFavoriteStore(
      favoriteStoreFromRow(row),
      row.updated_at,
    )) === "applied"
  ) {
    notifyDataChanged("favoriteStores");
  }
}

async function handleFavoriteFood(payload: LoosePayload, userId: string) {
  if (payload.eventType === "DELETE") {
    await handleDeletion(payload, userId, "favoriteFoods", "id");
    return;
  }
  const row = newRow<FavoriteFoodRow>(payload);
  if (!row) return;
  if (
    (await applyServerFavoriteFood(
      favoriteFoodFromRow(row),
      row.updated_at,
    )) === "applied"
  ) {
    notifyDataChanged("favoriteFoods");
  }
}

async function handleMicronutrientProfile(payload: LoosePayload) {
  // No DELETE path: profiles are a derived cache, never user-deleted.
  // A server-side DELETE (e.g. account cascade) would arrive here, but
  // a lingering cache row is harmless and gets wiped on sign-out's
  // clearAllStores — so we ignore DELETE and only apply upserts.
  if (payload.eventType === "DELETE") return;
  const row = newRow<MicronutrientProfileRow>(payload);
  if (!row) return;
  // No own-echo check: the client never pushes these, so every event
  // is a genuine cron write from the server.
  if (
    (await applyServerMicronutrientProfile(
      micronutrientProfileFromRow(row),
      row.updated_at,
    )) === "applied"
  ) {
    notifyDataChanged("micronutrientProfiles");
  }
}

// ─── Own echoes & deletions ─────────────────────────────────────────

// Own echoes need no special casing: when this device pushes a row, the
// server fires the change back to us, and `applyServerX` decides inside one
// IDB transaction — a local copy that is still dirty (the echo raced our
// mark-synced, or the user edited mid-push) is never overwritten, and a
// clean copy already at that version with the same content is a no-op.

/** Stores whose server primary key includes `user_id`, because the key
 *  alone is shared across users: the date-keyed tables are
 *  `(user_id, date)`, and favorite_stores is `(user_id, id)` since migration
 *  0077 (its id is a shared OSM key such as `node/123`). A DELETE's `old`
 *  for these always carries the owner. */
const OWNER_KEYED_STORES: ReadonlySet<DeletableStore> = new Set([
  "dailyLogs",
  "weightHistory",
  "favoriteStores",
]);

/** The local key a realtime DELETE refers to, or `null` when the event
 *  isn't provably about this user's row. Supabase Realtime cannot filter
 *  DELETE events and does not apply RLS to them ("Delete events are not
 *  filterable", https://supabase.com/docs/guides/realtime/postgres-changes),
 *  so every subscriber receives every user's deletes and `old` carries only
 *  the primary key. For an owner-keyed store (see `OWNER_KEYED_STORES`)
 *  another user deleting their row with the same date or OSM key would
 *  delete ours without the owner check, so the event must name this user.
 *  The other id-keyed tables use globally unique UUID keys; their `old` has
 *  no `user_id`, and a key we hold locally is ours. */
function deletedKey(
  payload: LoosePayload,
  userId: string,
  store: DeletableStore,
  keyField: "date" | "id",
): string | null {
  const old = payload.old as Record<string, unknown> | undefined;
  const key = old?.[keyField];
  if (typeof key !== "string" || key === "") return null;
  const owner = old?.user_id;
  if (OWNER_KEYED_STORES.has(store)) return owner === userId ? key : null;
  return owner === undefined || owner === userId ? key : null;
}

async function handleDeletion(
  payload: LoosePayload,
  userId: string,
  store: DeletableStore,
  keyField: "date" | "id",
): Promise<void> {
  const key = deletedKey(payload, userId, store, keyField);
  if (!key) return;
  if ((await applyServerDeletion(store, key)) === "deleted") {
    notifyDataChanged(store);
  }
}
