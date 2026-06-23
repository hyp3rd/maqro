"use client";

import type { Recipe } from "@/components/macro/types";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import {
  applyServerBloodPressure,
  applyServerBodyMeasurement,
  applyServerCustomFood,
  applyServerDailyLog,
  applyServerDeletion,
  applyServerFastSession,
  applyServerFavoriteFood,
  applyServerFavoriteStore,
  applyServerMealTemplate,
  applyServerPantryItem,
  applyServerPantryNotification,
  applyServerMealSchedule,
  applyServerMicronutrientProfile,
  applyServerProfile,
  applyServerRecipe,
  applyServerSupplement,
  applyServerSupplementIntake,
  applyServerWaterIntake,
  applyServerWeightEntry,
  clearAllStores,
  clearDeletion,
  getProfileRecord,
  listBloodPressure,
  listBodyMeasurements,
  listCustomFoods,
  listDailyLogs,
  listDeletions,
  listFastSessions,
  listFavoriteFoods,
  listFavoriteStores,
  listMealSchedules,
  listMealTemplates,
  listMicronutrientProfiles,
  listPantryItems,
  listPantryNotifications,
  listRecipes,
  listSupplementIntake,
  listSupplements,
  listWaterIntake,
  listWeightEntries,
  markBloodPressureSynced,
  markBodyMeasurementSynced,
  markCustomFoodSynced,
  markFastSessionSynced,
  markFavoriteFoodSynced,
  markFavoriteStoreSynced,
  markDailyLogSynced,
  markMealScheduleSynced,
  markMealTemplateSynced,
  markPantryItemSynced,
  markPantryNotificationSynced,
  markProfileSynced,
  markRecipeSynced,
  markSupplementIntakeSynced,
  markSupplementSynced,
  markWaterIntakeSynced,
  markWeightEntrySynced,
  upsertCustomFood,
  upsertMealSchedule,
  upsertMealTemplate,
  upsertPantryItem,
  upsertPantryNotification,
  upsertRecipe,
  upsertSupplement,
  type BloodPressure,
  type BodyMeasurement,
  type CustomFood,
  type DailyLog,
  type DeletionRecord,
  type FastSession,
  type MealSchedule,
  type MealTemplate,
  type PantryItem,
  type PantryNotification,
  type Supplement,
  type SupplementIntake,
  type WaterIntake,
  type WeightEntry,
} from "@/lib/db";
import {
  getSyncStatus,
  setSyncConflict,
  setSyncError,
  setSynced,
  setSyncing,
} from "@/lib/sync-status";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthError } from "./auth-error";
import { notifyDataChanged } from "./data-bus";
import {
  customFoodFromRow,
  customFoodToRow,
  dailyLogFromRow,
  dailyLogToRow,
  fastSessionFromRow,
  fastSessionToRow,
  favoriteFoodFromRow,
  favoriteFoodToRow,
  favoriteStoreFromRow,
  favoriteStoreToRow,
  mealScheduleFromRow,
  mealScheduleToRow,
  mealTemplateFromRow,
  mealTemplateToRow,
  micronutrientProfileFromRow,
  pantryItemFromRow,
  pantryItemToRow,
  pantryNotificationFromRow,
  pantryNotificationToRow,
  profileFromRow,
  profileToRow,
  recipeFromRow,
  recipeToRow,
  supplementFromRow,
  supplementIntakeFromRow,
  supplementIntakeToRow,
  supplementToRow,
  waterFromRow,
  waterToRow,
  weightFromRow,
  weightToRow,
  bloodPressureFromRow,
  bloodPressureToRow,
  bodyMeasurementFromRow,
  bodyMeasurementToRow,
  type BloodPressureRow,
  type BodyMeasurementRow,
  type CustomFoodRow,
  type DailyLogRow,
  type FastSessionRow,
  type FavoriteFoodRow,
  type FavoriteStoreRow,
  type MealScheduleRow,
  type MealTemplateRow,
  type MicronutrientProfileRow,
  type PantryItemRow,
  type PantryNotificationRow,
  type ProfileRow,
  type RecipeRow,
  type SupplementIntakeRow,
  type SupplementRow,
  type WaterRow,
  type WeightRow,
} from "./mappers";

export type SyncResult = {
  pushed: {
    profile: number;
    dailyLogs: number;
    weightEntries: number;
    waterIntake: number;
    supplementIntake: number;
    bodyMeasurements: number;
    bloodPressure: number;
    fastSessions: number;
    customFoods: number;
    mealTemplates: number;
    recipes: number;
    mealSchedules: number;
    supplements: number;
    pantryItems: number;
    pantryNotifications: number;
    favoriteStores: number;
    favoriteFoods: number;
    micronutrientProfiles: number;
  };
  pulled: {
    profile: number;
    dailyLogs: number;
    weightEntries: number;
    waterIntake: number;
    supplementIntake: number;
    bodyMeasurements: number;
    bloodPressure: number;
    fastSessions: number;
    customFoods: number;
    mealTemplates: number;
    recipes: number;
    mealSchedules: number;
    supplements: number;
    pantryItems: number;
    pantryNotifications: number;
    favoriteStores: number;
    favoriteFoods: number;
    micronutrientProfiles: number;
  };
  /** Rows whose push was rejected because another device had already
   *  changed them since we last pulled. The conflict UI (Pass 2) reads
   *  this to tell the user what didn't sync; for now sync-status pill
   *  surfaces the count. */
  conflicts: number;
  /** Tombstones successfully propagated to the server this run. Used
   *  by the sync-status pill so users know their delete *did* land
   *  (otherwise the silent "I just deleted this — is it really gone
   *  on the other device?" question.) */
  deletionsPushed: number;
};

const ZERO_COUNTS = {
  profile: 0,
  dailyLogs: 0,
  weightEntries: 0,
  waterIntake: 0,
  supplementIntake: 0,
  bodyMeasurements: 0,
  bloodPressure: 0,
  fastSessions: 0,
  customFoods: 0,
  mealTemplates: 0,
  recipes: 0,
  mealSchedules: 0,
  supplements: 0,
  pantryItems: 0,
  pantryNotifications: 0,
  favoriteStores: 0,
  favoriteFoods: 0,
  micronutrientProfiles: 0,
};

/** Pull then push, in that order — critical on a first sign-in (fresh
 *  IDB, e.g. an incognito window). If we pushed first, any synthetic
 *  "default" row a hook had just written to IDB (an empty meals array,
 *  a default-shaped profile) would `upsert` over the server's real
 *  data and wipe it. Pull-first means the server is the source of
 *  truth: real data lands in IDB before any push gets a chance to
 *  send junk back up. On subsequent runs (data already in IDB and
 *  marked clean) the pull is a no-op for unchanged rows; only genuine
 *  user edits are dirty and get pushed.
 *
 *  Push handles its own optimistic-concurrency check
 *  (`.eq("updated_at", serverUpdatedAt)`) — conflicts on push (rejected
 *  because a peer device changed the same row first) are counted and
 *  surfaced via `result.conflicts`; the row stays dirty so the next
 *  sync, post-pull, has a fresh base to retry from.
 *
 *  Idempotent — re-running converges to the latest server state for
 *  every clean row and pushes any still-dirty rows on the next attempt. */
export async function runInitialSync(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    pushed: { ...ZERO_COUNTS },
    pulled: { ...ZERO_COUNTS },
    conflicts: 0,
    deletionsPushed: 0,
  };

  // Drain deletion tombstones FIRST. If the user deleted a row
  // locally since the last sync, we want that delete to land on the
  // server before the upcoming pull — otherwise pull would re-fetch
  // the row and write it straight back into IDB ("silent
  // resurrection" bug). Failures here are not fatal; the tombstone
  // stays in the store and the next sync retries.
  await pushDeletions(supabase, result);

  // Pull next — see the comment above for the incognito-clobber reason.
  await pullProfile(supabase, userId, result);
  await pullDailyLogs(supabase, userId, result);
  await pullWeightEntries(supabase, userId, result);
  await pullWaterIntake(supabase, userId, result);
  await pullSupplementIntake(supabase, userId, result);
  await pullBodyMeasurements(supabase, userId, result);
  await pullBloodPressure(supabase, userId, result);
  await pullFastSessions(supabase, userId, result);
  await pullCustomFoods(supabase, userId, result);
  await pullMealTemplates(supabase, userId, result);
  await pullRecipes(supabase, userId, result);
  await pullMealSchedules(supabase, userId, result);
  await pullSupplements(supabase, userId, result);
  await pullPantryItems(supabase, userId, result);
  await pullPantryNotifications(supabase, userId, result);
  await pullFavoriteStores(supabase, userId, result);
  await pullFavoriteFoods(supabase, userId, result);
  // Pull-only: micronutrient profiles are written server-side by the
  // enrichment cron. The client never authors them locally in v1, so
  // there's no push counterpart — nothing is ever dirty here.
  await pullMicronutrientProfiles(supabase, userId, result);

  await pushProfile(supabase, userId, result);
  await pushDailyLogs(supabase, userId, result);
  await pushWeightEntries(supabase, userId, result);
  await pushWaterIntake(supabase, userId, result);
  await pushSupplementIntake(supabase, userId, result);
  await pushBodyMeasurements(supabase, userId, result);
  await pushBloodPressure(supabase, userId, result);
  await pushFastSessions(supabase, userId, result);
  await pushCustomFoods(supabase, userId, result);
  await pushMealTemplates(supabase, userId, result);
  await pushRecipes(supabase, userId, result);
  await pushMealSchedules(supabase, userId, result);
  await pushSupplements(supabase, userId, result);
  await pushPantryItems(supabase, userId, result);
  await pushPantryNotifications(supabase, userId, result);
  await pushFavoriteStores(supabase, userId, result);
  await pushFavoriteFoods(supabase, userId, result);

  return result;
}

/** Wraps {@link runInitialSync} with sync-status side-effects so both the
 * auto-sync on sign-in and any manual "Sync now" button share one path. */
export async function triggerSync(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult | null> {
  if (getSyncStatus().state === "syncing") return null;
  setSyncing();
  try {
    const result = await runInitialSync(supabase, userId);
    // A successful sync can still leave dirty rows behind when the
    // server's version moved on between our pull and our push — those
    // are real conflicts the user needs to know about. Surface them on
    // the status pill instead of silently flipping to "synced".
    if (result.conflicts > 0) {
      setSyncConflict(result.conflicts);
    } else {
      setSynced();
    }
    return result;
  } catch (err) {
    setSyncError(err);
    // Auth-flavored failures (expired JWT, rotated refresh token, the
    // user got deleted server-side, RLS no longer resolves) mean the
    // session can't recover on its own — and continuing to accept
    // local edits would just pile up dirty rows that never push. Tear
    // the local state down so the next render sees `!user` and
    // prompts a clean re-sign-in. Fire-and-forget: we still rethrow
    // so the caller's promise rejects with the original error shape.
    if (isAuthError(err)) {
      void signOutAndClearLocal(supabase);
    }
    throw err;
  }
}

/** "Throw away every local edit and accept the server's state." Wipes
 *  IDB completely (including pending tombstones — so a row the user
 *  deleted but hasn't synced gets resurrected from the server too),
 *  then runs a normal sync so the data refills from upstream. The
 *  realtime layer doesn't have to wait — the next `triggerSync` pull
 *  pass writes everything via `applyServerX`, which also fires the
 *  data bus so hooks re-hydrate.
 *
 *  Used by the "Discard local changes" affordance on the sync pill.
 *  Like `triggerSync` it's non-reentrant on the sync-status state, so
 *  a concurrent sync gets a `null` and the caller can retry. */
export async function discardPendingChanges(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult | null> {
  if (getSyncStatus().state === "syncing") return null;
  setSyncing();
  try {
    // Wipe local first so the pending counter / dirty-row check can't
    // see anything to push. clearAllStores also wipes tombstones so
    // we don't end up server-deleting a row the user changed their
    // mind about discarding.
    await clearAllStores();
    const result = await runInitialSync(supabase, userId);
    // After discard, there should be no conflicts (we have nothing
    // dirty to push). Surface as plain "synced".
    setSynced();
    return result;
  } catch (err) {
    setSyncError(err);
    throw err;
  }
}

const CALL_TIMEOUT_MS = 60_000;

async function withTimeout<T>(
  label: string,
  fn: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || controller.signal.aborted)
    ) {
      throw new Error(`${label} timed out after ${CALL_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function asError(
  err: { message?: string; code?: string; details?: string; hint?: string },
  context: string,
): Error {
  const parts = [err.message ?? "Supabase error"];
  if (err.code) parts.push(`(${err.code})`);
  if (err.details) parts.push(`— ${err.details}`);
  return new Error(`${context}: ${parts.join(" ")}`);
}

// ─── Push helpers ──────────────────────────────────────────────────────────

/** One-row push outcome. */
type PushResult =
  | { status: "inserted" | "updated"; serverUpdatedAt: string }
  | { status: "conflict" }
  | { status: "uuid-collision" };

/** Generic per-row push with optimistic concurrency. If `serverUpdatedAt`
 *  is null (row was created locally, never reached the server), insert.
 *  Otherwise UPDATE with the version check — if zero rows are affected,
 *  the row's version on the server has moved on, which we treat as a
 *  conflict. The caller is responsible for marking the local row as
 *  synced via the returned `serverUpdatedAt`.
 *
 *  Why generic: every table is a copy of the same dance, only the table
 *  name and PK filters differ. Centralizing it keeps the per-table push
 *  functions to a handful of lines each. */
async function pushRow<Row extends object>(
  supabase: SupabaseClient,
  table: string,
  row: Row,
  pkFields: Record<string, string | number>,
  serverUpdatedAt: string | null | undefined,
  label: string,
): Promise<PushResult> {
  if (!serverUpdatedAt) {
    // No server token — either a fresh local row or a row whose token
    // was lost. upsert handles both: row exists upstream → update;
    // doesn't → insert. The .select() round-trip gives us the new
    // server-side updated_at.
    const { data, error } = await withTimeout(label, (signal) =>
      supabase
        .from(table)
        .upsert(row)
        .select("updated_at")
        .abortSignal(signal)
        .single(),
    );
    if (error) {
      // RLS row-owned-by-someone-else (UUID collision across users)
      // surfaces here as 42501. Caller can retry with a fresh UUID.
      if ((error as { code?: string }).code === "42501") {
        return { status: "uuid-collision" };
      }
      throw asError(error, label);
    }
    return {
      status: "inserted",
      serverUpdatedAt: (data as { updated_at: string }).updated_at,
    };
  }
  // Existing row — UPDATE with version check. Postgres evaluates WHERE
  // before the trigger that bumps updated_at, so the equality matches
  // the *pre-update* value. A mismatch returns zero rows. We chain the
  // PK filters first (one .eq() per field) and the version filter last.
  const { data, error } = await withTimeout(label, (signal) => {
    let q = supabase.from(table).update(row);
    for (const [k, v] of Object.entries(pkFields)) {
      q = q.eq(k, v);
    }
    return q
      .eq("updated_at", serverUpdatedAt)
      .select("updated_at")
      .abortSignal(signal)
      .maybeSingle();
  });
  if (error) throw asError(error, label);
  if (!data) return { status: "conflict" };
  return {
    status: "updated",
    serverUpdatedAt: (data as { updated_at: string }).updated_at,
  };
}

/** A local row is "dirty" — needs pushing — when its server token is
 *  missing or doesn't match its local-mod token. Centralized so the
 *  semantics are identical for every store. */
function isDirty(row: {
  localUpdatedAt?: string;
  serverUpdatedAt?: string | null;
}): boolean {
  if (!row.serverUpdatedAt) return true;
  return row.localUpdatedAt !== row.serverUpdatedAt;
}

// ─── Push deletions (tombstone drain) ─────────────────────────────────────

/** Maps the `DeletableStore` enum (which matches the IDB store names)
 *  to the Supabase table name and the PK column we filter on. Profile
 *  is not in the map because it's never user-deleteable through this
 *  path — the only profile deletion is "delete account" which has its
 *  own server route. */
const DELETE_TARGET: Record<
  DeletionRecord["storeName"],
  { table: string; pk: string }
> = {
  customFoods: { table: "custom_foods", pk: "id" },
  mealTemplates: { table: "meal_templates", pk: "id" },
  recipes: { table: "recipes", pk: "id" },
  mealSchedules: { table: "meal_schedules", pk: "id" },
  supplements: { table: "supplements", pk: "id" },
  dailyLogs: { table: "daily_logs", pk: "date" },
  weightHistory: { table: "weight_history", pk: "date" },
  bodyMeasurements: { table: "body_measurements", pk: "date" },
  bloodPressure: { table: "blood_pressure", pk: "date" },
  fastSessions: { table: "fast_sessions", pk: "id" },
  pantryItems: { table: "pantry_items", pk: "id" },
  pantryNotifications: { table: "pantry_notifications", pk: "id" },
  favoriteStores: { table: "favorite_stores", pk: "id" },
  favoriteFoods: { table: "favorite_foods", pk: "id" },
};

/** Drains the IDB deletion-tombstone store: for each tombstone, issues
 *  `DELETE FROM <table> WHERE <pk> = <rowKey>` server-side and clears
 *  the tombstone on success. Per-tombstone errors are swallowed (the
 *  tombstone stays in the store; the next sync retries) so a single
 *  network blip doesn't abort the whole sync. */
async function pushDeletions(supabase: SupabaseClient, result: SyncResult) {
  let tombstones: DeletionRecord[];
  try {
    tombstones = await listDeletions();
  } catch {
    return;
  }
  for (const t of tombstones) {
    const target = DELETE_TARGET[t.storeName];
    if (!target) {
      // Unknown store name (shouldn't happen — types prevent it, but
      // defensive). Clear the tombstone so it doesn't loop forever.
      await clearDeletion(t.storeName, t.rowKey).catch(() => {});
      continue;
    }
    const { error } = await withTimeout(
      `push deletion ${target.table}#${t.rowKey}`,
      (signal) =>
        supabase
          .from(target.table)
          .delete()
          .eq(target.pk, t.rowKey)
          .abortSignal(signal),
    ).catch((err) => ({ error: err as { message?: string } }));
    if (error) {
      // Don't drop the tombstone — try again next sync. Common reasons
      // we'd hit this: transient network failure, RLS misconfig. We
      // do NOT throw, so the rest of the sync still runs.
      continue;
    }
    await clearDeletion(t.storeName, t.rowKey).catch(() => {});
    result.deletionsPushed++;
  }
}

// ─── Push ──────────────────────────────────────────────────────────────────

async function pushProfile(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const profile = await getProfileRecord();
  if (!profile) return;
  if (!isDirty(profile)) return;
  const row = profileToRow(userId, stripVersioned(profile));
  const outcome = await pushRow<Pick<ProfileRow, "user_id" | "payload">>(
    supabase,
    "profiles",
    row,
    { user_id: userId },
    profile.serverUpdatedAt,
    "push profile",
  );
  if (outcome.status === "conflict") {
    result.conflicts++;
    return;
  }
  if (outcome.status === "inserted" || outcome.status === "updated") {
    await markProfileSynced(outcome.serverUpdatedAt);
    result.pushed.profile = 1;
  }
}

async function pushDailyLogs(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const logs = await listDailyLogs();
  for (const log of logs) {
    if (!isDirty(log)) continue;
    const row = dailyLogToRow(userId, log);
    const outcome = await pushRow(
      supabase,
      "daily_logs",
      row,
      { user_id: userId, date: log.date },
      log.serverUpdatedAt,
      "push daily log",
    );
    if (outcome.status === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome.status === "inserted" || outcome.status === "updated") {
      await markDailyLogSynced(log.date, outcome.serverUpdatedAt);
      result.pushed.dailyLogs++;
    }
  }
}

async function pushWeightEntries(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const entries = await listWeightEntries();
  for (const entry of entries) {
    if (!isDirty(entry)) continue;
    const row = weightToRow(userId, entry);
    const outcome = await pushRow(
      supabase,
      "weight_history",
      row,
      { user_id: userId, date: entry.date },
      entry.serverUpdatedAt,
      "push weight entry",
    );
    if (outcome.status === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome.status === "inserted" || outcome.status === "updated") {
      await markWeightEntrySynced(entry.date, outcome.serverUpdatedAt);
      result.pushed.weightEntries++;
    }
  }
}

async function pushWaterIntake(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const entries = await listWaterIntake();
  for (const entry of entries) {
    if (!isDirty(entry)) continue;
    const row = waterToRow(userId, entry);
    const outcome = await pushRow(
      supabase,
      "water_intake",
      row,
      { user_id: userId, date: entry.date },
      entry.serverUpdatedAt,
      "push water intake",
    );
    if (outcome.status === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome.status === "inserted" || outcome.status === "updated") {
      await markWaterIntakeSynced(entry.date, outcome.serverUpdatedAt);
      result.pushed.waterIntake++;
    }
  }
}

async function pushSupplementIntake(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const entries = await listSupplementIntake();
  for (const entry of entries) {
    if (!isDirty(entry)) continue;
    const row = supplementIntakeToRow(userId, entry);
    const outcome = await pushRow(
      supabase,
      "supplement_intake",
      row,
      { user_id: userId, date: entry.date },
      entry.serverUpdatedAt,
      "push supplement intake",
    );
    if (outcome.status === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome.status === "inserted" || outcome.status === "updated") {
      await markSupplementIntakeSynced(entry.date, outcome.serverUpdatedAt);
      result.pushed.supplementIntake++;
    }
  }
}

async function pushBodyMeasurements(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const entries = await listBodyMeasurements();
  for (const entry of entries) {
    if (!isDirty(entry)) continue;
    const row = bodyMeasurementToRow(userId, entry);
    const outcome = await pushRow(
      supabase,
      "body_measurements",
      row,
      { user_id: userId, date: entry.date },
      entry.serverUpdatedAt,
      "push body measurement",
    );
    if (outcome.status === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome.status === "inserted" || outcome.status === "updated") {
      await markBodyMeasurementSynced(entry.date, outcome.serverUpdatedAt);
      result.pushed.bodyMeasurements++;
    }
  }
}

async function pushBloodPressure(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const entries = await listBloodPressure();
  for (const entry of entries) {
    if (!isDirty(entry)) continue;
    const row = bloodPressureToRow(userId, entry);
    const outcome = await pushRow(
      supabase,
      "blood_pressure",
      row,
      { user_id: userId, date: entry.date },
      entry.serverUpdatedAt,
      "push blood pressure",
    );
    if (outcome.status === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome.status === "inserted" || outcome.status === "updated") {
      await markBloodPressureSynced(entry.date, outcome.serverUpdatedAt);
      result.pushed.bloodPressure++;
    }
  }
}

async function pushFastSessions(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const entries = await listFastSessions();
  for (const entry of entries) {
    if (!isDirty(entry)) continue;
    const row = fastSessionToRow(userId, entry);
    const outcome = await pushRow(
      supabase,
      "fast_sessions",
      row,
      { user_id: userId, id: entry.id },
      entry.serverUpdatedAt,
      "push fast session",
    );
    if (outcome.status === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome.status === "inserted" || outcome.status === "updated") {
      await markFastSessionSynced(entry.id, outcome.serverUpdatedAt);
      result.pushed.fastSessions++;
    }
  }
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushCustomFoods(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const foods = await listCustomFoods();
  for (const food of foods) {
    if (!isDirty(food)) continue;
    const outcome = await pushCustomFoodOnce(
      supabase,
      userId,
      food,
      "push custom food",
    );
    if (outcome === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome === "synced") result.pushed.customFoods++;
  }
}

async function pushCustomFoodOnce(
  supabase: SupabaseClient,
  userId: string,
  food: CustomFood,
  label: string,
): Promise<"synced" | "conflict"> {
  const row = customFoodToRow(userId, food);
  const outcome = await pushRow(
    supabase,
    "custom_foods",
    row,
    { id: food.id },
    food.serverUpdatedAt,
    label,
  );
  if (outcome.status === "conflict") return "conflict";
  if (outcome.status === "uuid-collision") {
    // Re-mint locally and retry once. Bubbles into a fresh INSERT
    // path which goes through the no-server-token branch above.
    const newId = crypto.randomUUID();
    await upsertCustomFood({ ...food, id: newId, serverUpdatedAt: null });
    // UUID-collision recovery: re-mint the local row with a fresh
    // UUID and drop the old one. We use applyServerDeletion (not
    // deleteCustomFood) so a tombstone *isn't* created — the OLD UUID
    // never belonged to this user on the server, so we have nothing
    // to delete server-side.
    await applyServerDeletion("customFoods", food.id);
    const retry = await pushCustomFoodOnce(
      supabase,
      userId,
      { ...food, id: newId, serverUpdatedAt: null },
      `${label} (re-mint retry)`,
    );
    return retry;
  }
  await markCustomFoodSynced(food.id, outcome.serverUpdatedAt);
  return "synced";
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushMealTemplates(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const templates = await listMealTemplates();
  for (const template of templates) {
    if (!isDirty(template)) continue;
    const outcome = await pushTemplateOnce(
      supabase,
      userId,
      template,
      "push meal template",
    );
    if (outcome === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome === "synced") result.pushed.mealTemplates++;
  }
}

async function pushTemplateOnce(
  supabase: SupabaseClient,
  userId: string,
  template: MealTemplate,
  label: string,
): Promise<"synced" | "conflict"> {
  const row = mealTemplateToRow(userId, template);
  const outcome = await pushRow(
    supabase,
    "meal_templates",
    row,
    { id: template.id },
    template.serverUpdatedAt,
    label,
  );
  if (outcome.status === "conflict") return "conflict";
  if (outcome.status === "uuid-collision") {
    const newId = crypto.randomUUID();
    await upsertMealTemplate({ ...template, id: newId, serverUpdatedAt: null });
    await applyServerDeletion("mealTemplates", template.id);
    return pushTemplateOnce(
      supabase,
      userId,
      { ...template, id: newId, serverUpdatedAt: null },
      `${label} (re-mint retry)`,
    );
  }
  await markMealTemplateSynced(template.id, outcome.serverUpdatedAt);
  return "synced";
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushRecipes(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const recipes = await listRecipes();
  for (const recipe of recipes) {
    if (!isDirty(recipe)) continue;
    const outcome = await pushRecipeOnce(
      supabase,
      userId,
      recipe,
      "push recipe",
    );
    if (outcome === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome === "synced") result.pushed.recipes++;
  }
}

async function pushRecipeOnce(
  supabase: SupabaseClient,
  userId: string,
  recipe: Recipe,
  label: string,
): Promise<"synced" | "conflict"> {
  const row = recipeToRow(userId, recipe);
  const outcome = await pushRow(
    supabase,
    "recipes",
    row,
    { id: recipe.id },
    (recipe as Recipe & { serverUpdatedAt?: string | null }).serverUpdatedAt,
    label,
  );
  if (outcome.status === "conflict") return "conflict";
  if (outcome.status === "uuid-collision") {
    const newId = crypto.randomUUID();
    await upsertRecipe({
      ...recipe,
      id: newId,
      serverUpdatedAt: null,
    } as Recipe & { serverUpdatedAt: null });
    await applyServerDeletion("recipes", recipe.id);
    return pushRecipeOnce(
      supabase,
      userId,
      { ...recipe, id: newId },
      `${label} (re-mint retry)`,
    );
  }
  await markRecipeSynced(recipe.id, outcome.serverUpdatedAt);
  return "synced";
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushMealSchedules(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const schedules = await listMealSchedules();
  for (const schedule of schedules) {
    if (!isDirty(schedule)) continue;
    const outcome = await pushMealScheduleOnce(
      supabase,
      userId,
      schedule,
      "push meal schedule",
    );
    if (outcome === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome === "synced") result.pushed.mealSchedules++;
  }
}

async function pushMealScheduleOnce(
  supabase: SupabaseClient,
  userId: string,
  schedule: MealSchedule,
  label: string,
): Promise<"synced" | "conflict"> {
  const row = mealScheduleToRow(userId, schedule);
  const outcome = await pushRow(
    supabase,
    "meal_schedules",
    row,
    { id: schedule.id },
    (schedule as MealSchedule & { serverUpdatedAt?: string | null })
      .serverUpdatedAt,
    label,
  );
  if (outcome.status === "conflict") return "conflict";
  if (outcome.status === "uuid-collision") {
    const newId = crypto.randomUUID();
    await upsertMealSchedule({
      ...schedule,
      id: newId,
      serverUpdatedAt: null,
    } as MealSchedule & { serverUpdatedAt: null });
    await applyServerDeletion("mealSchedules", schedule.id);
    return pushMealScheduleOnce(
      supabase,
      userId,
      { ...schedule, id: newId },
      `${label} (re-mint retry)`,
    );
  }
  await markMealScheduleSynced(schedule.id, outcome.serverUpdatedAt);
  return "synced";
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushSupplements(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const supplements = await listSupplements();
  for (const supplement of supplements) {
    if (!isDirty(supplement)) continue;
    const outcome = await pushSupplementOnce(
      supabase,
      userId,
      supplement,
      "push supplement",
    );
    if (outcome === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome === "synced") result.pushed.supplements++;
  }
}

async function pushSupplementOnce(
  supabase: SupabaseClient,
  userId: string,
  supplement: Supplement,
  label: string,
): Promise<"synced" | "conflict"> {
  const row = supplementToRow(userId, supplement);
  const outcome = await pushRow(
    supabase,
    "supplements",
    row,
    { id: supplement.id },
    (supplement as Supplement & { serverUpdatedAt?: string | null })
      .serverUpdatedAt,
    label,
  );
  if (outcome.status === "conflict") return "conflict";
  if (outcome.status === "uuid-collision") {
    const newId = crypto.randomUUID();
    await upsertSupplement({
      ...supplement,
      id: newId,
      serverUpdatedAt: null,
    } as Supplement & { serverUpdatedAt: null });
    await applyServerDeletion("supplements", supplement.id);
    return pushSupplementOnce(
      supabase,
      userId,
      { ...supplement, id: newId },
      `${label} (re-mint retry)`,
    );
  }
  await markSupplementSynced(supplement.id, outcome.serverUpdatedAt);
  return "synced";
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushPantryItems(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const items = await listPantryItems();
  for (const item of items) {
    if (!isDirty(item)) continue;
    const outcome = await pushPantryItemOnce(
      supabase,
      userId,
      item,
      "push pantry item",
    );
    if (outcome === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome === "synced") result.pushed.pantryItems++;
  }
}

async function pushPantryItemOnce(
  supabase: SupabaseClient,
  userId: string,
  item: PantryItem,
  label: string,
): Promise<"synced" | "conflict"> {
  const row = pantryItemToRow(userId, item);
  const outcome = await pushRow(
    supabase,
    "pantry_items",
    row,
    { id: item.id },
    item.serverUpdatedAt,
    label,
  );
  if (outcome.status === "conflict") return "conflict";
  if (outcome.status === "uuid-collision") {
    const newId = crypto.randomUUID();
    await upsertPantryItem({ ...item, id: newId, serverUpdatedAt: null });
    await applyServerDeletion("pantryItems", item.id);
    return pushPantryItemOnce(
      supabase,
      userId,
      { ...item, id: newId },
      `${label} (re-mint retry)`,
    );
  }
  await markPantryItemSynced(item.id, outcome.serverUpdatedAt);
  return "synced";
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushPantryNotifications(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const notifs = await listPantryNotifications();
  for (const notif of notifs) {
    if (!isDirty(notif)) continue;
    const outcome = await pushPantryNotificationOnce(
      supabase,
      userId,
      notif,
      "push pantry notification",
    );
    if (outcome === "conflict") {
      result.conflicts++;
      continue;
    }
    if (outcome === "synced") result.pushed.pantryNotifications++;
  }
}

async function pushPantryNotificationOnce(
  supabase: SupabaseClient,
  userId: string,
  notif: PantryNotification,
  label: string,
): Promise<"synced" | "conflict"> {
  const row = pantryNotificationToRow(userId, notif);
  const outcome = await pushRow(
    supabase,
    "pantry_notifications",
    row,
    { id: notif.id },
    notif.serverUpdatedAt,
    label,
  );
  if (outcome.status === "conflict") return "conflict";
  if (outcome.status === "uuid-collision") {
    const newId = crypto.randomUUID();
    await upsertPantryNotification({
      ...notif,
      id: newId,
      serverUpdatedAt: null,
    });
    await applyServerDeletion("pantryNotifications", notif.id);
    return pushPantryNotificationOnce(
      supabase,
      userId,
      { ...notif, id: newId },
      `${label} (re-mint retry)`,
    );
  }
  await markPantryNotificationSynced(notif.id, outcome.serverUpdatedAt);
  return "synced";
}

export async function pushFavoriteStores(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const stores = await listFavoriteStores();
  for (const store of stores) {
    if (!isDirty(store)) continue;
    // Favourite PKs are OSM keys (text), not UUIDs — no re-mint path.
    const outcome = await pushRow(
      supabase,
      "favorite_stores",
      favoriteStoreToRow(userId, store),
      { id: store.id },
      store.serverUpdatedAt,
      "push favorite store",
    );
    if (outcome.status === "conflict" || outcome.status === "uuid-collision") {
      result.conflicts++;
      continue;
    }
    await markFavoriteStoreSynced(store.id, outcome.serverUpdatedAt);
    result.pushed.favoriteStores++;
  }
}

/** @internal Exported for unit tests. Not part of the stable sync API. */
export async function pushFavoriteFoods(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const foods = await listFavoriteFoods();
  for (const fav of foods) {
    if (!isDirty(fav)) continue;
    // UUID PKs (client-minted) — a collision is astronomically unlikely,
    // so treat it as a conflict rather than carrying a re-mint path.
    const outcome = await pushRow(
      supabase,
      "favorite_foods",
      favoriteFoodToRow(userId, fav),
      { id: fav.id },
      fav.serverUpdatedAt,
      "push favorite food",
    );
    if (outcome.status === "conflict" || outcome.status === "uuid-collision") {
      result.conflicts++;
      continue;
    }
    await markFavoriteFoodSynced(fav.id, outcome.serverUpdatedAt);
    result.pushed.favoriteFoods++;
  }
}

// ─── Pull ──────────────────────────────────────────────────────────────────
// Every pull calls applyServerX so the local row reads as clean
// (localUpdatedAt === serverUpdatedAt) — otherwise the very next sync
// would see every pulled row as dirty and try to push it back.

async function pullProfile(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull profile", (signal) =>
    supabase
      .from("profiles")
      .select("user_id, payload, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal)
      .maybeSingle(),
  );
  if (error) throw asError(error, "pull profile");
  if (!data) return;
  const row = data as ProfileRow;
  const profile = profileFromRow(row);
  // Only overwrite locally if the server is strictly newer than what
  // we last saw. Otherwise leave the local copy alone — it may be a
  // dirty local edit that hasn't been pushed yet.
  const local = await getProfileRecord();
  if (shouldApplyServer(local?.serverUpdatedAt, row.updated_at)) {
    await applyServerProfile(profile, row.updated_at);
    result.pulled.profile = 1;
    // Tell the data bus so useProfile re-runs its load effect and
    // updates React state. Without this, the hook would keep its
    // pre-sync in-memory state and the next debounced save would
    // overwrite the row we just pulled.
    notifyDataChanged("profile");
  }
}

async function pullDailyLogs(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull daily logs", (signal) =>
    supabase
      .from("daily_logs")
      .select("user_id, date, meals, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull daily logs");
  if (!data) return;
  const locals = new Map(
    (await listDailyLogs()).map((l: DailyLog) => [l.date, l]),
  );
  const before = result.pulled.dailyLogs;
  for (const row of data as DailyLogRow[]) {
    const localRow = locals.get(row.date);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    const log = dailyLogFromRow(row);
    await applyServerDailyLog(log.date, log.meals, row.updated_at);
    result.pulled.dailyLogs++;
  }
  if (result.pulled.dailyLogs > before) notifyDataChanged("dailyLogs");
}

async function pullWeightEntries(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull weight history", (signal) =>
    supabase
      .from("weight_history")
      .select("user_id, date, kg, recorded_at, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull weight history");
  if (!data) return;
  const locals = new Map(
    (await listWeightEntries()).map((e: WeightEntry) => [e.date, e]),
  );
  const before = result.pulled.weightEntries;
  for (const row of data as WeightRow[]) {
    const localRow = locals.get(row.date);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    const entry = weightFromRow(row);
    await applyServerWeightEntry(entry.date, entry.kg, row.updated_at);
    result.pulled.weightEntries++;
  }
  if (result.pulled.weightEntries > before) notifyDataChanged("weightHistory");
}

async function pullWaterIntake(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull water intake", (signal) =>
    supabase
      .from("water_intake")
      .select("user_id, date, ml, recorded_at, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull water intake");
  if (!data) return;
  const locals = new Map(
    (await listWaterIntake()).map((e: WaterIntake) => [e.date, e]),
  );
  const before = result.pulled.waterIntake;
  for (const row of data as WaterRow[]) {
    const localRow = locals.get(row.date);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    const entry = waterFromRow(row);
    await applyServerWaterIntake(entry.date, entry.ml, row.updated_at);
    result.pulled.waterIntake++;
  }
  if (result.pulled.waterIntake > before) notifyDataChanged("waterIntake");
}

async function pullSupplementIntake(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout(
    "pull supplement intake",
    (signal) =>
      supabase
        .from("supplement_intake")
        .select("user_id, date, taken, recorded_at, updated_at")
        .eq("user_id", userId)
        .abortSignal(signal),
  );
  if (error) throw asError(error, "pull supplement intake");
  if (!data) return;
  const locals = new Map(
    (await listSupplementIntake()).map((e: SupplementIntake) => [e.date, e]),
  );
  const before = result.pulled.supplementIntake;
  for (const row of data as SupplementIntakeRow[]) {
    const localRow = locals.get(row.date);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    const entry = supplementIntakeFromRow(row);
    await applyServerSupplementIntake(entry.date, entry.taken, row.updated_at);
    result.pulled.supplementIntake++;
  }
  if (result.pulled.supplementIntake > before)
    notifyDataChanged("supplementIntake");
}

async function pullBodyMeasurements(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout(
    "pull body measurements",
    (signal) =>
      supabase
        .from("body_measurements")
        .select(
          "user_id, date, waist_cm, neck_cm, hips_cm, notes, recorded_at, updated_at",
        )
        .eq("user_id", userId)
        .abortSignal(signal),
  );
  if (error) throw asError(error, "pull body measurements");
  if (!data) return;
  const locals = new Map(
    (await listBodyMeasurements()).map((e: BodyMeasurement) => [e.date, e]),
  );
  const before = result.pulled.bodyMeasurements;
  for (const row of data as BodyMeasurementRow[]) {
    const localRow = locals.get(row.date);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    const entry = bodyMeasurementFromRow(row);
    await applyServerBodyMeasurement(
      entry.date,
      {
        waistCm: entry.waistCm,
        neckCm: entry.neckCm,
        hipsCm: entry.hipsCm,
        notes: entry.notes,
      },
      row.updated_at,
    );
    result.pulled.bodyMeasurements++;
  }
  if (result.pulled.bodyMeasurements > before)
    notifyDataChanged("bodyMeasurements");
}

async function pullBloodPressure(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull blood pressure", (signal) =>
    supabase
      .from("blood_pressure")
      .select(
        "user_id, date, systolic, diastolic, pulse, notes, recorded_at, updated_at",
      )
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull blood pressure");
  if (!data) return;
  const locals = new Map(
    (await listBloodPressure()).map((e: BloodPressure) => [e.date, e]),
  );
  const before = result.pulled.bloodPressure;
  for (const row of data as BloodPressureRow[]) {
    const localRow = locals.get(row.date);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    const entry = bloodPressureFromRow(row);
    await applyServerBloodPressure(
      entry.date,
      {
        systolic: entry.systolic,
        diastolic: entry.diastolic,
        pulse: entry.pulse,
        notes: entry.notes,
      },
      row.updated_at,
    );
    result.pulled.bloodPressure++;
  }
  if (result.pulled.bloodPressure > before) notifyDataChanged("bloodPressure");
}

async function pullFastSessions(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull fast sessions", (signal) =>
    supabase
      .from("fast_sessions")
      .select(
        "user_id, id, started_at, ended_at, protocol, target_hours, updated_at",
      )
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull fast sessions");
  if (!data) return;
  const locals = new Map(
    (await listFastSessions()).map((e: FastSession) => [e.id, e]),
  );
  const before = result.pulled.fastSessions;
  for (const row of data as FastSessionRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerFastSession(fastSessionFromRow(row), row.updated_at);
    result.pulled.fastSessions++;
  }
  if (result.pulled.fastSessions > before) notifyDataChanged("fastSessions");
}

async function pullCustomFoods(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull custom foods", (signal) =>
    supabase
      .from("custom_foods")
      .select(
        "id, user_id, name, protein, carbs, fat, calories, brand, category, sub_category, diet_kind, sort_order, sugars, added_sugars, fiber, saturated_fat, trans_fat, mono_fat, poly_fat, micronutrients, created_at, updated_at",
      )
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull custom foods");
  if (!data) return;
  const locals = new Map(
    (await listCustomFoods()).map((f: CustomFood) => [f.id, f]),
  );
  const before = result.pulled.customFoods;
  for (const row of data as CustomFoodRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerCustomFood(customFoodFromRow(row), row.updated_at);
    result.pulled.customFoods++;
  }
  if (result.pulled.customFoods > before) notifyDataChanged("customFoods");
}

async function pullMealTemplates(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull meal templates", (signal) =>
    supabase
      .from("meal_templates")
      .select("id, user_id, name, foods, sort_order, created_at, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull meal templates");
  if (!data) return;
  const locals = new Map(
    (await listMealTemplates()).map((t: MealTemplate) => [t.id, t]),
  );
  const before = result.pulled.mealTemplates;
  for (const row of data as MealTemplateRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerMealTemplate(mealTemplateFromRow(row), row.updated_at);
    result.pulled.mealTemplates++;
  }
  if (result.pulled.mealTemplates > before) notifyDataChanged("mealTemplates");
}

async function pullRecipes(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull recipes", (signal) =>
    supabase
      .from("recipes")
      .select(
        "id, user_id, name, ingredients, cuisine, notes, sort_order, share_slug, share_visibility, source_url, servings, prep_time_minutes, created_at, updated_at",
      )
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull recipes");
  if (!data) return;
  const locals = new Map(
    (await listRecipes()).map(
      (r: Recipe & { serverUpdatedAt?: string | null }) => [r.id, r],
    ),
  );
  const before = result.pulled.recipes;
  for (const row of data as RecipeRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerRecipe(recipeFromRow(row), row.updated_at);
    result.pulled.recipes++;
  }
  if (result.pulled.recipes > before) notifyDataChanged("recipes");
}

async function pullMealSchedules(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull meal schedules", (signal) =>
    supabase
      .from("meal_schedules")
      .select(
        "id, user_id, name, recipe_id, meal_names, start_date, end_date, days_of_week, scale, sort_order, created_at, updated_at",
      )
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull meal schedules");
  if (!data) return;
  const locals = new Map(
    (await listMealSchedules()).map(
      (s: MealSchedule & { serverUpdatedAt?: string | null }) => [s.id, s],
    ),
  );
  const before = result.pulled.mealSchedules;
  for (const row of data as MealScheduleRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerMealSchedule(mealScheduleFromRow(row), row.updated_at);
    result.pulled.mealSchedules++;
  }
  if (result.pulled.mealSchedules > before) notifyDataChanged("mealSchedules");
}

async function pullSupplements(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull supplements", (signal) =>
    supabase
      .from("supplements")
      .select(
        "id, user_id, name, dose_label, micros, schedule, notes, sort_order, created_at, updated_at",
      )
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull supplements");
  if (!data) return;
  const locals = new Map(
    (await listSupplements()).map(
      (s: Supplement & { serverUpdatedAt?: string | null }) => [s.id, s],
    ),
  );
  const before = result.pulled.supplements;
  for (const row of data as SupplementRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerSupplement(supplementFromRow(row), row.updated_at);
    result.pulled.supplements++;
  }
  if (result.pulled.supplements > before) notifyDataChanged("supplements");
}

async function pullPantryItems(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull pantry items", (signal) =>
    supabase
      .from("pantry_items")
      .select("id, user_id, name, quantity, unit, note, created_at, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull pantry items");
  if (!data) return;
  const locals = new Map((await listPantryItems()).map((p) => [p.id, p]));
  const before = result.pulled.pantryItems;
  for (const row of data as PantryItemRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerPantryItem(pantryItemFromRow(row), row.updated_at);
    result.pulled.pantryItems++;
  }
  if (result.pulled.pantryItems > before) notifyDataChanged("pantryItems");
}

async function pullPantryNotifications(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout(
    "pull pantry notifications",
    (signal) =>
      supabase
        .from("pantry_notifications")
        .select(
          "id, user_id, type, item_id, item_name, quantity, unit, read, created_at, updated_at",
        )
        .eq("user_id", userId)
        .abortSignal(signal),
  );
  if (error) throw asError(error, "pull pantry notifications");
  if (!data) return;
  const locals = new Map(
    (await listPantryNotifications()).map((n) => [n.id, n]),
  );
  const before = result.pulled.pantryNotifications;
  for (const row of data as PantryNotificationRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerPantryNotification(
      pantryNotificationFromRow(row),
      row.updated_at,
    );
    result.pulled.pantryNotifications++;
  }
  if (result.pulled.pantryNotifications > before) {
    notifyDataChanged("pantryNotifications");
  }
}

async function pullFavoriteStores(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull favorite stores", (signal) =>
    supabase
      .from("favorite_stores")
      .select(
        "id, user_id, name, kind, lat, lon, address, created_at, updated_at",
      )
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull favorite stores");
  if (!data) return;
  const locals = new Map((await listFavoriteStores()).map((s) => [s.id, s]));
  const before = result.pulled.favoriteStores;
  for (const row of data as FavoriteStoreRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerFavoriteStore(favoriteStoreFromRow(row), row.updated_at);
    result.pulled.favoriteStores++;
  }
  if (result.pulled.favoriteStores > before) {
    notifyDataChanged("favoriteStores");
  }
}

async function pullFavoriteFoods(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout("pull favorite foods", (signal) =>
    supabase
      .from("favorite_foods")
      .select("id, user_id, name_key, food, portion, created_at, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal),
  );
  if (error) throw asError(error, "pull favorite foods");
  if (!data) return;
  const locals = new Map((await listFavoriteFoods()).map((f) => [f.id, f]));
  const before = result.pulled.favoriteFoods;
  for (const row of data as FavoriteFoodRow[]) {
    const localRow = locals.get(row.id);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerFavoriteFood(favoriteFoodFromRow(row), row.updated_at);
    result.pulled.favoriteFoods++;
  }
  if (result.pulled.favoriteFoods > before) {
    notifyDataChanged("favoriteFoods");
  }
}

/** Pull micronutrient profiles the enrichment cron wrote server-side.
 *  Pull-only — there's no local authoring path in v1, so unlike the
 *  other stores there's no push counterpart. Keyed by `name_key`
 *  locally (the unique identity both sides share). */
async function pullMicronutrientProfiles(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const { data, error } = await withTimeout(
    "pull micronutrient profiles",
    (signal) =>
      supabase
        .from("micronutrient_profiles")
        .select(
          // `breakdown` (migration 0065) MUST be selected — the mapper
          // (`micronutrientProfileFromRow`) reads it, so omitting it silently
          // dropped the macro-breakdown backfill on every synced profile.
          "user_id, name_key, values, source, source_code, breakdown, enriched_at, updated_at",
        )
        .eq("user_id", userId)
        .abortSignal(signal),
  );
  if (error) throw asError(error, "pull micronutrient profiles");
  if (!data) return;
  const locals = new Map(
    (await listMicronutrientProfiles()).map((p) => [p.nameKey, p]),
  );
  const before = result.pulled.micronutrientProfiles;
  for (const row of data as MicronutrientProfileRow[]) {
    const localRow = locals.get(row.name_key);
    if (!shouldApplyServer(localRow?.serverUpdatedAt, row.updated_at)) continue;
    await applyServerMicronutrientProfile(
      micronutrientProfileFromRow(row),
      row.updated_at,
    );
    result.pulled.micronutrientProfiles++;
  }
  if (result.pulled.micronutrientProfiles > before) {
    notifyDataChanged("micronutrientProfiles");
  }
}

/** Should we overwrite local with this server row? Yes if we've never
 *  pulled it before, OR if its server timestamp is newer than the one
 *  we last saw. Avoids the bug where pull-after-push unconditionally
 *  clobbers a local edit made in the small window between our push and
 *  our pull. */
function shouldApplyServer(
  localServerUpdatedAt: string | null | undefined,
  serverUpdatedAt: string,
): boolean {
  if (!localServerUpdatedAt) return true;
  return Date.parse(serverUpdatedAt) > Date.parse(localServerUpdatedAt);
}

/** Strip the Versioned mixin from a saved row so it round-trips through
 *  the mappers (which expect clean PersonalInfo / DailyLog / etc). */
function stripVersioned<T extends object>(
  row: T & { localUpdatedAt?: string; serverUpdatedAt?: string | null },
): T {
  const { localUpdatedAt: _l, serverUpdatedAt: _s, ...rest } = row;
  void _l;
  void _s;
  return rest as T;
}
