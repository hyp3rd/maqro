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
  applyServerWeightEntry,
  applyServerDeletion,
  getProfileRecord,
} from "@/lib/db";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import { notifyDataChanged, type SyncedTable } from "./data-bus";
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
 *  write the new row into IDB via the matching `applyServerX` helper
 *  and notify the data bus so React hooks re-fetch. On `DELETE`, call
 *  the local `deleteX` and notify.
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
        (payload) => {
          void handleProfile(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-daily-logs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_logs", filter },
        (payload) => {
          void handleDailyLog(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-weight-history")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weight_history", filter },
        (payload) => {
          void handleWeight(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-custom-foods")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "custom_foods", filter },
        (payload) => {
          void handleCustomFood(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-meal-templates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meal_templates", filter },
        (payload) => {
          void handleMealTemplate(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-recipes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "recipes", filter },
        (payload) => {
          void handleRecipe(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-pantry-items")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pantry_items", filter },
        (payload) => {
          void handlePantryItem(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-pantry-notifications")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pantry_notifications", filter },
        (payload) => {
          void handlePantryNotification(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );

  channels.push(
    supabase
      .channel("sync-favorite-stores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "favorite_stores", filter },
        (payload) => {
          void handleFavoriteStore(payload);
        },
      )
      .subscribe(buildSubscribeHandler()),
  );
  channels.push(
    supabase
      .channel("sync-favorite-foods")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "favorite_foods", filter },
        (payload) => {
          void handleFavoriteFood(payload);
        },
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
        (payload) => {
          void handleMicronutrientProfile(payload);
        },
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
  if (await isOwnEcho("profile", row.updated_at)) return;
  await applyServerProfile(profileFromRow(row), row.updated_at);
  notifyDataChanged("profile");
}

async function handleDailyLog(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<DailyLogRow> | undefined;
    if (old?.date) await applyServerDeletion("dailyLogs", old.date);
    notifyDataChanged("dailyLogs");
    return;
  }
  const row = newRow<DailyLogRow>(payload);
  if (!row) return;
  if (await isOwnEcho("dailyLogs", row.updated_at)) return;
  const log = dailyLogFromRow(row);
  await applyServerDailyLog(log.date, log.meals, row.updated_at);
  notifyDataChanged("dailyLogs");
}

async function handleWeight(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<WeightRow> | undefined;
    if (old?.date) await applyServerDeletion("weightHistory", old.date);
    notifyDataChanged("weightHistory");
    return;
  }
  const row = newRow<WeightRow>(payload);
  if (!row) return;
  if (await isOwnEcho("weightHistory", row.updated_at)) return;
  const entry = weightFromRow(row);
  await applyServerWeightEntry(entry.date, entry.kg, row.updated_at);
  notifyDataChanged("weightHistory");
}

async function handleCustomFood(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<CustomFoodRow> | undefined;
    if (old?.id) await applyServerDeletion("customFoods", old.id);
    notifyDataChanged("customFoods");
    return;
  }
  const row = newRow<CustomFoodRow>(payload);
  if (!row) return;
  if (await isOwnEcho("customFoods", row.updated_at)) return;
  await applyServerCustomFood(customFoodFromRow(row), row.updated_at);
  notifyDataChanged("customFoods");
}

async function handleMealTemplate(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<MealTemplateRow> | undefined;
    if (old?.id) await applyServerDeletion("mealTemplates", old.id);
    notifyDataChanged("mealTemplates");
    return;
  }
  const row = newRow<MealTemplateRow>(payload);
  if (!row) return;
  if (await isOwnEcho("mealTemplates", row.updated_at)) return;
  await applyServerMealTemplate(mealTemplateFromRow(row), row.updated_at);
  notifyDataChanged("mealTemplates");
}

async function handleRecipe(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<RecipeRow> | undefined;
    if (old?.id) await applyServerDeletion("recipes", old.id);
    notifyDataChanged("recipes");
    return;
  }
  const row = newRow<RecipeRow>(payload);
  if (!row) return;
  if (await isOwnEcho("recipes", row.updated_at)) return;
  await applyServerRecipe(recipeFromRow(row), row.updated_at);
  notifyDataChanged("recipes");
}

async function handlePantryItem(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<PantryItemRow> | undefined;
    if (old?.id) await applyServerDeletion("pantryItems", old.id);
    notifyDataChanged("pantryItems");
    return;
  }
  const row = newRow<PantryItemRow>(payload);
  if (!row) return;
  if (await isOwnEcho("pantryItems", row.updated_at)) return;
  await applyServerPantryItem(pantryItemFromRow(row), row.updated_at);
  notifyDataChanged("pantryItems");
}

async function handlePantryNotification(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<PantryNotificationRow> | undefined;
    if (old?.id) await applyServerDeletion("pantryNotifications", old.id);
    notifyDataChanged("pantryNotifications");
    return;
  }
  const row = newRow<PantryNotificationRow>(payload);
  if (!row) return;
  if (await isOwnEcho("pantryNotifications", row.updated_at)) return;
  await applyServerPantryNotification(
    pantryNotificationFromRow(row),
    row.updated_at,
  );
  notifyDataChanged("pantryNotifications");
}

async function handleFavoriteStore(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<FavoriteStoreRow> | undefined;
    if (old?.id) await applyServerDeletion("favoriteStores", old.id);
    notifyDataChanged("favoriteStores");
    return;
  }
  const row = newRow<FavoriteStoreRow>(payload);
  if (!row) return;
  if (await isOwnEcho("favoriteStores", row.updated_at)) return;
  await applyServerFavoriteStore(favoriteStoreFromRow(row), row.updated_at);
  notifyDataChanged("favoriteStores");
}

async function handleFavoriteFood(payload: LoosePayload) {
  if (payload.eventType === "DELETE") {
    const old = payload.old as Partial<FavoriteFoodRow> | undefined;
    if (old?.id) await applyServerDeletion("favoriteFoods", old.id);
    notifyDataChanged("favoriteFoods");
    return;
  }
  const row = newRow<FavoriteFoodRow>(payload);
  if (!row) return;
  if (await isOwnEcho("favoriteFoods", row.updated_at)) return;
  await applyServerFavoriteFood(favoriteFoodFromRow(row), row.updated_at);
  notifyDataChanged("favoriteFoods");
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
  await applyServerMicronutrientProfile(
    micronutrientProfileFromRow(row),
    row.updated_at,
  );
  notifyDataChanged("micronutrientProfiles");
}

// ─── Own-echo detection ──────────────────────────────────────────────

/** When this device pushes a row, the server fires a Realtime event
 *  back to us. We've already written the row locally (and
 *  `markXSynced` set `serverUpdatedAt` to the new server timestamp).
 *  If the incoming event's `updated_at` matches what we already have
 *  locally, it's our own echo — skip it. Otherwise it's a change
 *  from a peer device and we apply it.
 *
 *  We look up the local row by key per-table; for tables we only
 *  store a single row of (profile), we just compare the cached
 *  `serverUpdatedAt`. For per-id stores we'd need a key-specific
 *  read, but the cost of a redundant IDB write is small enough that
 *  we accept it for the row-id case if we don't have a quick lookup
 *  — `applyServerX` is idempotent. */
async function isOwnEcho(
  table: SyncedTable,
  serverUpdatedAt: string,
): Promise<boolean> {
  if (table === "profile") {
    const local = await getProfileRecord();
    return local?.serverUpdatedAt === serverUpdatedAt;
  }
  // Per-key own-echo detection on the other tables would require a
  // store-specific `get` — for Pass 2 we accept the redundant write
  // (applyServerX is idempotent, so it's free of side effects). The
  // bus notify still fires, which is correct: the hook re-reads the
  // value it already had. Pass 3 can add per-store getRecord helpers
  // if profiling shows this hurts.
  return false;
}
