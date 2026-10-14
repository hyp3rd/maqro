"use client";

import type { Recipe } from "@/components/macro/types";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import {
  applyServerBloodPressure,
  applyServerBodyMeasurement,
  applyServerCustomFood,
  applyServerDailyLog,
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
  isDirtyRecord,
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
  markProfileSynced,
  markRecordSynced,
  rebaseDirtyProfile,
  rebaseDirtyRecord,
  reconcileServerAbsences,
  reassignLocalRecordId,
  type ApplyServerOutcome,
  type DeletionRecord,
  type SyncStoreName,
  type Versioned,
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

type SyncCountKey = keyof SyncResult["pushed"];

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

/** Thrown at the END of a sync run when one or more steps failed. Every
 *  table's pull and push — and every row within a push — runs in
 *  isolation: a server-rejected row (a CHECK violation, say) or a failed
 *  table request no longer aborts the rest of the run. The failures are
 *  collected and surfaced together here, so the status pill still reports
 *  the error while everything that *could* sync did. The rejected rows
 *  stay dirty and are retried on the next sync. */
export class SyncIncompleteError extends Error {
  readonly errors: readonly unknown[];

  constructor(errors: readonly unknown[]) {
    const messages = errors.map(errorMessage);
    super(
      messages.length === 1
        ? messages[0]
        : `${messages.length} sync steps failed: ${messages.join("; ")}`,
    );
    this.name = "SyncIncompleteError";
    this.errors = errors;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

/** Run one isolated sync step. A failure is collected into `errors` and the
 *  run carries on — except an auth failure (expired JWT, revoked session),
 *  which every later request would hit too: that one aborts the run
 *  immediately so `triggerSync` can sign the user out. */
async function isolate(
  errors: unknown[],
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (err) {
    if (isAuthError(err)) throw err;
    errors.push(err);
  }
}

/** Shared state of one sync run, handed to every per-table step. */
type SyncRun = {
  supabase: SupabaseClient;
  userId: string;
  result: SyncResult;
  errors: unknown[];
};

/** Pull then push. On subsequent runs (data already in IDB and marked
 *  clean) the pull is a no-op for unchanged rows; only genuine user edits
 *  are dirty and get pushed. Pulling first also settles rows whose last
 *  push landed without its acknowledgement (they adopt the server version
 *  instead of being re-sent).
 *
 *  A pull NEVER overwrites a dirty local row — including one this device
 *  created and never synced (see the sync-engine primitives in
 *  `lib/db.ts`). Pull-first therefore does NOT stop a synthetic "default"
 *  row a hook wrote to a fresh IDB from being pushed; the hooks'
 *  `hasRealLocalData` guards do that. What keeps any such row from
 *  replacing the server's data is the push itself:
 *   - a dirty row whose base version is stale — another device changed the
 *     row since we last pulled — fails the UPDATE's optimistic-concurrency
 *     check (`.eq("updated_at", serverUpdatedAt)`);
 *   - a never-synced row on a natural-key table (a date-keyed table, the
 *     profile) is sent with a plain INSERT, which a peer's row for the same
 *     key rejects (23505) instead of being overwritten.
 *  Both are counted in `result.conflicts` and surfaced on the status pill.
 *  The row stays dirty until the user resolves it: "keep this device's
 *  version" ({@link resolveConflictsKeepingLocal}) or "discard"
 *  ({@link discardPendingChanges}).
 *
 *  Every pull is a full, paginated read of the user's rows, so after it
 *  the engine also reconciles remote deletes (rows a peer deleted while
 *  this device was offline, or on a table without realtime).
 *
 *  Every step runs in isolation (see {@link SyncIncompleteError}).
 *
 *  Idempotent — re-running converges to the latest server state for
 *  every clean row and pushes any still-dirty rows on the next attempt. */
export async function runInitialSync(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult> {
  const run: SyncRun = {
    supabase,
    userId,
    result: {
      pushed: { ...ZERO_COUNTS },
      pulled: { ...ZERO_COUNTS },
      conflicts: 0,
      deletionsPushed: 0,
    },
    errors: [],
  };
  const step = (fn: () => Promise<void>) => isolate(run.errors, fn);

  // Drain deletion tombstones FIRST. If the user deleted a row
  // locally since the last sync, we want that delete to land on the
  // server before the upcoming pull. (A tombstone that fails to push
  // also keeps the pull from writing the row back — see
  // `applyServerRecord`.)
  await step(() => pushDeletions(run));

  // Pull next, so the push below starts from the server's current state.
  await step(() => pullProfile(supabase, userId, run.result));
  for (const table of SYNC_TABLES) await step(() => table.pull(run));

  await step(() => pushProfile(supabase, userId, run.result));
  for (const table of SYNC_TABLES) await step(() => table.push(run));

  if (run.errors.length > 0) throw new SyncIncompleteError(run.errors);
  return run.result;
}

/** Map a finished run onto the status pill. A successful sync can still
 *  leave dirty rows behind when a peer device changed them first — those
 *  are real conflicts the user needs to know about, so surface them
 *  instead of silently flipping to "synced". */
function settleSyncStatus(result: SyncResult): void {
  if (result.conflicts > 0) {
    setSyncConflict(result.conflicts);
  } else {
    setSynced();
  }
}

/** Record a failed run on the status pill. Auth-flavored failures (expired
 *  JWT, rotated refresh token, the user got deleted server-side, RLS no
 *  longer resolves) mean the session can't recover on its own — and
 *  continuing to accept local edits would just pile up dirty rows that
 *  never push. Tear the local state down so the next render sees `!user`
 *  and prompts a clean re-sign-in. Fire-and-forget: the caller still
 *  rethrows so its promise rejects with the original error shape. */
function surfaceSyncFailure(supabase: SupabaseClient, err: unknown): void {
  setSyncError(err);
  if (isAuthError(err)) {
    void signOutAndClearLocal(supabase);
  }
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
    settleSyncStatus(result);
    return result;
  } catch (err) {
    surfaceSyncFailure(supabase, err);
    throw err;
  }
}

/** Conflict resolution "keep this device's version" — the action behind the
 *  status pill's "Needs review" state, reached only through its
 *  confirmation dialog. For every dirty row whose base version is stale —
 *  or, on a natural-key table, that was never synced but whose key a peer
 *  already created — adopt the server's CURRENT version token as the new
 *  base without touching the row's content (or clear it when the server row
 *  is gone), then run a normal sync: the push is now a versioned UPDATE
 *  that passes the optimistic-concurrency check, and this device's version
 *  replaces the other device's. Only ever run on an explicit user choice —
 *  automatic syncs keep surfacing the conflict instead of silently picking
 *  a side.
 *
 *  Non-reentrant on the sync-status state like {@link triggerSync}. */
export async function resolveConflictsKeepingLocal(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult | null> {
  if (getSyncStatus().state === "syncing") return null;
  setSyncing();
  try {
    const rebaseErrors: unknown[] = [];
    await isolate(rebaseErrors, () => rebaseProfileConflict(supabase, userId));
    for (const table of SYNC_TABLES) {
      await isolate(rebaseErrors, () => table.rebase(supabase, userId));
    }
    let result: SyncResult;
    try {
      result = await runInitialSync(supabase, userId);
    } catch (err) {
      if (rebaseErrors.length > 0 && err instanceof SyncIncompleteError) {
        throw new SyncIncompleteError([...rebaseErrors, ...err.errors]);
      }
      throw err;
    }
    if (rebaseErrors.length > 0) throw new SyncIncompleteError(rebaseErrors);
    settleSyncStatus(result);
    return result;
  } catch (err) {
    surfaceSyncFailure(supabase, err);
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
  | { status: "uuid-collision" }
  /** A never-synced row sent with INSERT found a server row already holding
   *  its key (PostgreSQL 23505, HTTP 409): another device created it. */
  | { status: "duplicate-key" };

/** How a never-synced row is created on the server.
 *  - `"insert"`: a plain INSERT, for rows identified by a NATURAL key (a
 *    date, the user id) that two devices can create independently. An
 *    existing server row is reported as `duplicate-key` and left alone —
 *    never overwritten.
 *  - `"upsert"`: for rows keyed by a client-minted UUID, where an existing
 *    row with our key can only be this device's own earlier push. */
type CreateMode = "insert" | "upsert";

/** Generic per-row push with optimistic concurrency. If `serverUpdatedAt`
 *  is null (row was created locally, never reached the server), create it
 *  per `create`. Otherwise UPDATE with the version check — if zero rows are
 *  affected, the row's version on the server has moved on, which we treat
 *  as a conflict. The caller is responsible for marking the local row as
 *  synced via the returned `serverUpdatedAt`.
 *
 *  Why generic: every table is a copy of the same dance, only the table
 *  name and PK filters differ. */
async function pushRow<Row extends object>(
  supabase: SupabaseClient,
  table: string,
  row: Row,
  pkFields: Record<string, string | number>,
  serverUpdatedAt: string | null | undefined,
  label: string,
  create: CreateMode,
): Promise<PushResult> {
  if (!serverUpdatedAt) {
    // No server token: a row this device created. The .select()
    // round-trip gives us the new server-side updated_at.
    const { data, error } = await withTimeout(label, (signal) => {
      const q = supabase.from(table);
      return (create === "insert" ? q.insert(row) : q.upsert(row))
        .select("updated_at")
        .abortSignal(signal)
        .single();
    });
    if (error) {
      const code = (error as { code?: string }).code;
      // RLS row-owned-by-someone-else (UUID collision across users)
      // surfaces here as 42501. Caller can retry with a fresh UUID.
      if (code === "42501") return { status: "uuid-collision" };
      if (code === "23505" && create === "insert") {
        return { status: "duplicate-key" };
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
 *  the tombstone on success. A failed delete keeps its tombstone (the
 *  next sync retries) and is collected into the run's errors — it does
 *  not stop the other tombstones or the rest of the sync. */
async function pushDeletions(run: SyncRun) {
  const tombstones = await listDeletions();
  for (const t of tombstones) {
    const target = DELETE_TARGET[t.storeName];
    if (!target) {
      // Unknown store name (shouldn't happen — types prevent it, but
      // defensive). Clear the tombstone so it doesn't loop forever.
      await clearDeletion(t.storeName, t.rowKey).catch(() => {});
      continue;
    }
    const label = `push deletion ${target.table}#${t.rowKey}`;
    await isolate(run.errors, async () => {
      const { error } = await withTimeout(label, (signal) =>
        run.supabase
          .from(target.table)
          .delete()
          .eq(target.pk, t.rowKey)
          .abortSignal(signal),
      );
      if (error) {
        if (isAuthError(error)) throw error;
        throw asError(error, label);
      }
      await clearDeletion(t.storeName, t.rowKey);
      run.result.deletionsPushed++;
    });
  }
}

// ─── Push ──────────────────────────────────────────────────────────────────
// The profile is a single row with its own push/pull below; every other
// table goes through the generic per-table sync further down.

async function pushProfile(
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
) {
  const profile = await getProfileRecord();
  if (!profile) return;
  if (!isDirtyRecord(profile)) return;
  const row = profileToRow(userId, stripVersioned(profile));
  const push = (base: string | null | undefined) =>
    pushRow<Pick<ProfileRow, "user_id" | "payload">>(
      supabase,
      "profiles",
      row,
      { user_id: userId },
      base,
      "push profile",
      // One row per user: a peer device can create it too, so a profile
      // this device never synced must not overwrite one that exists.
      "insert",
    );
  let outcome = await push(profile.serverUpdatedAt);
  if (outcome.status === "duplicate-key") {
    // The server's row may be the placeholder created with the account
    // (payload `{}`, "no profile yet") rather than a peer's profile: that
    // one is replaced through a versioned UPDATE on its token, so a peer
    // filling it in at the same moment still surfaces as a conflict.
    const placeholder = await placeholderProfileToken(supabase, userId);
    if (placeholder) outcome = await push(placeholder);
  }
  if (outcome.status === "conflict" || outcome.status === "duplicate-key") {
    result.conflicts++;
    return;
  }
  if (outcome.status === "inserted" || outcome.status === "updated") {
    await markProfileSynced(outcome.serverUpdatedAt, profile.localUpdatedAt);
    result.pushed.profile = 1;
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
  // `applyServerProfile` only writes when the server is strictly newer
  // than what we last saw AND the local copy isn't a dirty, unpushed edit.
  if ((await applyServerProfile(profile, row.updated_at)) === "applied") {
    result.pulled.profile = 1;
    // Tell the data bus so useProfile re-runs its load effect and
    // updates React state. Without this, the hook would keep its
    // pre-sync in-memory state and the next debounced save would
    // overwrite the row we just pulled.
    notifyDataChanged("profile");
  }
}

/** The `updated_at` of the user's server profile row when it is the
 *  placeholder created with the account — payload `{}`, meaning "no profile
 *  yet" — or null when there is no such row or it holds a real profile. */
async function placeholderProfileToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const label = "push profile (placeholder check)";
  const { data, error } = await withTimeout(label, (signal) =>
    supabase
      .from("profiles")
      .select("payload, updated_at")
      .eq("user_id", userId)
      .abortSignal(signal)
      .maybeSingle(),
  );
  if (error) throw asError(error, label);
  const row = data as { payload: unknown; updated_at: string } | null;
  const payload = row?.payload;
  const isPlaceholder =
    !!payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 0;
  return isPlaceholder && row ? row.updated_at : null;
}

/** Keep-local rebase for the profile row. See
 *  {@link resolveConflictsKeepingLocal}. A never-synced profile whose
 *  INSERT hit an existing server row takes that row's token, so the next
 *  push becomes a versioned UPDATE that replaces it. */
async function rebaseProfileConflict(supabase: SupabaseClient, userId: string) {
  const profile = await getProfileRecord();
  if (!profile || !isDirtyRecord(profile)) return;
  const base = profile.serverUpdatedAt ?? null;
  const { data, error } = await withTimeout("rebase profile", (signal) =>
    supabase
      .from("profiles")
      .select("updated_at")
      .eq("user_id", userId)
      .abortSignal(signal)
      .maybeSingle(),
  );
  if (error) throw asError(error, "rebase profile");
  const current = (data as { updated_at: string } | null)?.updated_at ?? null;
  if (current !== base) await rebaseDirtyProfile(base, current);
}

// ─── Per-table sync ────────────────────────────────────────────────────────

/** Rows requested per pull page. PostgREST silently caps a response at
 *  its `max_rows` (`[api] max_rows` in supabase/config.toml, and the hosted
 *  project's API setting, which the client can't see), so a page may come
 *  back shorter than this without the table being exhausted. The pull
 *  therefore never infers completeness from a short page — see
 *  {@link fetchAllRows}. */
export const PULL_PAGE_SIZE = 1000;

/** Keys passed per `.in(...)` filter in the keep-local rebase, keeping the
 *  request URL comfortably short. */
const REBASE_CHUNK_SIZE = 100;

/** Every column of `R`, as a literal list. The type argument makes the
 *  compiler reject a select list that misses any column of the row type the
 *  mapper reads (the bug class where `pullPantryItems` silently dropped
 *  `category` / `density` / `low_threshold`). */
function columnsOf<R>() {
  return <const C extends readonly (keyof R & string)[]>(
    columns: C &
      ([Exclude<keyof R, C[number]>] extends [never]
        ? unknown
        : { missingColumns: Exclude<keyof R, C[number]> }),
  ): readonly string[] => columns;
}

type LocalRecord = Pick<Versioned, "localUpdatedAt" | "serverUpdatedAt">;

/** Declarative description of one synced table. */
type TableSpec<R extends { updated_at: string }, L extends LocalRecord> = {
  table: string;
  store: SyncStoreName;
  countKey: SyncCountKey;
  /** Human noun for push error labels ("push daily log"). */
  noun: string;
  /** The column identifying a row within the user's rows (the local key). */
  keyColumn: keyof R & string;
  columns: readonly string[];
  rowKey: (row: R) => string;
  localKey: (local: L) => string;
  list: () => Promise<L[]>;
  apply: (row: R) => Promise<ApplyServerOutcome>;
  /** Absent for pull-only tables. */
  push?: {
    toRow: (userId: string, local: L) => object;
    pk: (userId: string, local: L) => Record<string, string>;
    /** How a never-synced row is created — `"insert"` for natural-key
     *  tables (see {@link CreateMode}): there a server row with the same
     *  key is a peer's, reported as a conflict instead of overwritten. */
    create: CreateMode;
    /** What a 42501 on insert means. Absent: a hard RLS rejection, surfaced
     *  as an error (composite-PK tables can't collide across users). */
    collision?:
      | "conflict"
      | { reassignId: (local: L, newId: string) => Promise<L | null> };
  };
};

/** The type-erased operations the run loop drives. */
type SyncTable = {
  table: string;
  columns: readonly string[];
  pull: (run: SyncRun) => Promise<void>;
  push: (run: SyncRun) => Promise<void>;
  rebase: (supabase: SupabaseClient, userId: string) => Promise<void>;
};

function defineTable<R extends { updated_at: string }, L extends LocalRecord>(
  spec: TableSpec<R, L>,
): SyncTable {
  return {
    table: spec.table,
    columns: spec.columns,
    pull: (run) => pullTable(run, spec),
    push: (run) => pushTable(run, spec),
    rebase: (supabase, userId) => rebaseTable(supabase, userId, spec),
  };
}

/** Read every row the user has in `spec.table`, keyset-paginated on the
 *  key column so concurrent inserts/deletes can't shift a page boundary.
 *  Only returns once a page comes back EMPTY: that, not a short page, is
 *  what proves the read complete, because a short page may just be the
 *  server's `max_rows` cap (see {@link PULL_PAGE_SIZE}). Remote-delete
 *  reconciliation deletes every clean local row missing from the result,
 *  so an incomplete read must never be returned. Costs one extra request
 *  per table per pull. */
async function fetchAllRows<
  R extends { updated_at: string },
  L extends LocalRecord,
>(run: SyncRun, spec: TableSpec<R, L>, label: string): Promise<R[]> {
  const rows: R[] = [];
  let after: string | null = null;
  for (;;) {
    const cursor = after;
    const { data, error } = await withTimeout(label, (signal) => {
      let q = run.supabase
        .from(spec.table)
        .select<string, R>(spec.columns.join(", "))
        .eq("user_id", run.userId);
      if (cursor !== null) q = q.gt(spec.keyColumn, cursor);
      return q
        .order(spec.keyColumn, { ascending: true })
        .limit(PULL_PAGE_SIZE)
        .abortSignal(signal);
    });
    if (error) throw asError(error, label);
    // No error but no array would make reconciliation see an empty server
    // and delete every clean local row — refuse rather than guess.
    if (!Array.isArray(data)) throw new Error(`${label}: no data returned`);
    const page: R[] = data;
    const last = page.at(-1);
    if (!last) return rows;
    rows.push(...page);
    after = spec.rowKey(last);
  }
}

async function pullTable<
  R extends { updated_at: string },
  L extends LocalRecord,
>(run: SyncRun, spec: TableSpec<R, L>): Promise<void> {
  const label = `pull ${spec.table}`;
  // Snapshot the local tokens BEFORE the SELECT: reconciliation only
  // removes rows that haven't changed since, so a realtime event applied
  // mid-pull is never mistaken for a remote delete.
  const baseline = new Map(
    (await spec.list()).map((l) => [spec.localKey(l), l.serverUpdatedAt]),
  );
  const rows = await fetchAllRows(run, spec, label);
  let changed = false;
  for (const row of rows) {
    if ((await spec.apply(row)) === "applied") {
      run.result.pulled[spec.countKey]++;
      changed = true;
    }
  }
  const { removed } = await reconcileServerAbsences(
    spec.store,
    new Set(rows.map(spec.rowKey)),
    baseline,
  );
  if (removed.length > 0) changed = true;
  if (changed) notifyDataChanged(spec.store);
}

async function pushTable<
  R extends { updated_at: string },
  L extends LocalRecord,
>(run: SyncRun, spec: TableSpec<R, L>): Promise<void> {
  if (!spec.push) return;
  const locals = await spec.list();
  for (const local of locals) {
    if (!isDirtyRecord(local)) continue;
    // Per-row isolation: one rejected row (e.g. a CHECK violation) stays
    // dirty and is reported, but every other row still syncs.
    await isolate(run.errors, () =>
      pushOne(run, spec, local, `push ${spec.noun}`, 1),
    );
  }
}

async function pushOne<R extends { updated_at: string }, L extends LocalRecord>(
  run: SyncRun,
  spec: TableSpec<R, L>,
  local: L,
  label: string,
  reassignmentsLeft: number,
): Promise<void> {
  const push = spec.push;
  if (!push) return;
  const outcome = await pushRow(
    run.supabase,
    spec.table,
    push.toRow(run.userId, local),
    push.pk(run.userId, local),
    local.serverUpdatedAt,
    label,
    push.create,
  );
  if (outcome.status === "conflict" || outcome.status === "duplicate-key") {
    run.result.conflicts++;
    return;
  }
  if (outcome.status === "uuid-collision") {
    if (push.collision === "conflict") {
      run.result.conflicts++;
      return;
    }
    if (!push.collision || reassignmentsLeft <= 0) {
      // Either a table that can't collide (so this is a genuine RLS
      // rejection) or a re-minted id that was rejected again — which a
      // fresh random UUID colliding twice can't explain. Surface it rather
      // than re-minting forever.
      throw new Error(
        `${label}: row-level security rejected the insert (42501)${
          push.collision ? " even after re-minting its id" : ""
        }`,
      );
    }
    const moved = await push.collision.reassignId(local, crypto.randomUUID());
    if (!moved) return; // Deleted locally meanwhile; its tombstone drains.
    await pushOne(
      run,
      spec,
      moved,
      `${label} (re-mint retry)`,
      reassignmentsLeft - 1,
    );
    return;
  }
  await markRecordSynced(
    spec.store,
    spec.localKey(local),
    outcome.serverUpdatedAt,
    local.localUpdatedAt,
  );
  run.result.pushed[spec.countKey]++;
}

async function rebaseTable<
  R extends { updated_at: string },
  L extends LocalRecord,
>(
  supabase: SupabaseClient,
  userId: string,
  spec: TableSpec<R, L>,
): Promise<void> {
  const push = spec.push;
  if (!push) return;
  // Dirty rows on a base the server may have moved past — and, on
  // natural-key tables, never-synced rows whose INSERT may have hit a
  // peer's row for the same key (they adopt that row's token, so the next
  // push is a versioned UPDATE that replaces it).
  const stale = (await spec.list()).filter(
    (l) =>
      isDirtyRecord(l) && (!!l.serverUpdatedAt || push.create === "insert"),
  );
  if (stale.length === 0) return;
  const label = `rebase ${spec.table}`;
  // Widened to `string`: only the key and the token are selected here, so
  // the rows are read as plain records rather than as full `R` rows.
  const keyColumn: string = spec.keyColumn;
  const current = new Map<string, string>();
  for (let i = 0; i < stale.length; i += REBASE_CHUNK_SIZE) {
    const keys = stale.slice(i, i + REBASE_CHUNK_SIZE).map(spec.localKey);
    const { data, error } = await withTimeout(label, (signal) =>
      supabase
        .from(spec.table)
        .select<string, Record<string, unknown>>(`${keyColumn}, updated_at`)
        .eq("user_id", userId)
        .in(keyColumn, keys)
        .abortSignal(signal),
    );
    if (error) throw asError(error, label);
    if (!Array.isArray(data)) throw new Error(`${label}: no data returned`);
    for (const row of data) {
      const key = row[keyColumn];
      const token = row.updated_at;
      if (typeof key === "string" && typeof token === "string") {
        current.set(key, token);
      }
    }
  }
  for (const local of stale) {
    const key = spec.localKey(local);
    const base = local.serverUpdatedAt ?? null;
    const now = current.get(key) ?? null;
    if (now !== base) await rebaseDirtyRecord(spec.store, key, base, now);
  }
}

// ─── Table catalogue ──────────────────────────────────────────────────────
// Order matters only for readability of the request log: it mirrors the
// historical pull/push order.

type RecipeRecord = Recipe & LocalRecord;

const SYNC_TABLES: readonly SyncTable[] = [
  defineTable({
    table: "daily_logs",
    store: "dailyLogs",
    countKey: "dailyLogs",
    noun: "daily log",
    keyColumn: "date",
    columns: columnsOf<DailyLogRow>()([
      "user_id",
      "date",
      "meals",
      "updated_at",
    ]),
    rowKey: (r: DailyLogRow) => r.date,
    localKey: (l) => l.date,
    list: listDailyLogs,
    apply: (r) => {
      const log = dailyLogFromRow(r);
      return applyServerDailyLog(log.date, log.meals, r.updated_at);
    },
    push: {
      toRow: dailyLogToRow,
      pk: (userId, l) => ({ user_id: userId, date: l.date }),
      create: "insert",
    },
  }),
  defineTable({
    table: "weight_history",
    store: "weightHistory",
    countKey: "weightEntries",
    noun: "weight entry",
    keyColumn: "date",
    columns: columnsOf<WeightRow>()([
      "user_id",
      "date",
      "kg",
      "recorded_at",
      "updated_at",
    ]),
    rowKey: (r: WeightRow) => r.date,
    localKey: (l) => l.date,
    list: listWeightEntries,
    apply: (r) => {
      const entry = weightFromRow(r);
      return applyServerWeightEntry(entry.date, entry.kg, r.updated_at);
    },
    push: {
      toRow: weightToRow,
      pk: (userId, l) => ({ user_id: userId, date: l.date }),
      create: "insert",
    },
  }),
  defineTable({
    table: "water_intake",
    store: "waterIntake",
    countKey: "waterIntake",
    noun: "water intake",
    keyColumn: "date",
    columns: columnsOf<WaterRow>()([
      "user_id",
      "date",
      "ml",
      "recorded_at",
      "updated_at",
    ]),
    rowKey: (r: WaterRow) => r.date,
    localKey: (l) => l.date,
    list: listWaterIntake,
    apply: (r) => {
      const entry = waterFromRow(r);
      return applyServerWaterIntake(entry.date, entry.ml, r.updated_at);
    },
    push: {
      toRow: waterToRow,
      pk: (userId, l) => ({ user_id: userId, date: l.date }),
      create: "insert",
    },
  }),
  defineTable({
    table: "supplement_intake",
    store: "supplementIntake",
    countKey: "supplementIntake",
    noun: "supplement intake",
    keyColumn: "date",
    columns: columnsOf<SupplementIntakeRow>()([
      "user_id",
      "date",
      "taken",
      "recorded_at",
      "updated_at",
    ]),
    rowKey: (r: SupplementIntakeRow) => r.date,
    localKey: (l) => l.date,
    list: listSupplementIntake,
    apply: (r) => {
      const entry = supplementIntakeFromRow(r);
      return applyServerSupplementIntake(entry.date, entry.taken, r.updated_at);
    },
    push: {
      toRow: supplementIntakeToRow,
      pk: (userId, l) => ({ user_id: userId, date: l.date }),
      create: "insert",
    },
  }),
  defineTable({
    table: "body_measurements",
    store: "bodyMeasurements",
    countKey: "bodyMeasurements",
    noun: "body measurement",
    keyColumn: "date",
    columns: columnsOf<BodyMeasurementRow>()([
      "user_id",
      "date",
      "waist_cm",
      "neck_cm",
      "hips_cm",
      "notes",
      "recorded_at",
      "updated_at",
    ]),
    rowKey: (r: BodyMeasurementRow) => r.date,
    localKey: (l) => l.date,
    list: listBodyMeasurements,
    apply: (r) => {
      const entry = bodyMeasurementFromRow(r);
      return applyServerBodyMeasurement(
        entry.date,
        {
          waistCm: entry.waistCm,
          neckCm: entry.neckCm,
          hipsCm: entry.hipsCm,
          notes: entry.notes,
        },
        r.updated_at,
      );
    },
    push: {
      toRow: bodyMeasurementToRow,
      pk: (userId, l) => ({ user_id: userId, date: l.date }),
      create: "insert",
    },
  }),
  defineTable({
    table: "blood_pressure",
    store: "bloodPressure",
    countKey: "bloodPressure",
    noun: "blood pressure reading",
    keyColumn: "date",
    columns: columnsOf<BloodPressureRow>()([
      "user_id",
      "date",
      "systolic",
      "diastolic",
      "pulse",
      "notes",
      "recorded_at",
      "updated_at",
    ]),
    rowKey: (r: BloodPressureRow) => r.date,
    localKey: (l) => l.date,
    list: listBloodPressure,
    apply: (r) => {
      const entry = bloodPressureFromRow(r);
      return applyServerBloodPressure(
        entry.date,
        {
          systolic: entry.systolic,
          diastolic: entry.diastolic,
          pulse: entry.pulse,
          notes: entry.notes,
        },
        r.updated_at,
      );
    },
    push: {
      toRow: bloodPressureToRow,
      pk: (userId, l) => ({ user_id: userId, date: l.date }),
      create: "insert",
    },
  }),
  defineTable({
    table: "fast_sessions",
    store: "fastSessions",
    countKey: "fastSessions",
    noun: "fast session",
    keyColumn: "id",
    columns: columnsOf<FastSessionRow>()([
      "user_id",
      "id",
      "started_at",
      "ended_at",
      "protocol",
      "target_hours",
      "updated_at",
    ]),
    rowKey: (r: FastSessionRow) => r.id,
    localKey: (l) => l.id,
    list: listFastSessions,
    apply: (r) => applyServerFastSession(fastSessionFromRow(r), r.updated_at),
    push: {
      toRow: fastSessionToRow,
      pk: (userId, l) => ({ user_id: userId, id: l.id }),
      create: "upsert",
    },
  }),
  defineTable({
    table: "custom_foods",
    store: "customFoods",
    countKey: "customFoods",
    noun: "custom food",
    keyColumn: "id",
    columns: columnsOf<CustomFoodRow>()([
      "id",
      "user_id",
      "name",
      "protein",
      "carbs",
      "fat",
      "calories",
      "brand",
      "category",
      "sub_category",
      "diet_kind",
      "sort_order",
      "sugars",
      "added_sugars",
      "fiber",
      "saturated_fat",
      "trans_fat",
      "mono_fat",
      "poly_fat",
      "micronutrients",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: CustomFoodRow) => r.id,
    localKey: (l) => l.id,
    list: listCustomFoods,
    apply: (r) => applyServerCustomFood(customFoodFromRow(r), r.updated_at),
    push: {
      toRow: customFoodToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      collision: {
        reassignId: (l, newId) =>
          reassignLocalRecordId("customFoods", l.id, newId),
      },
    },
  }),
  defineTable({
    table: "meal_templates",
    store: "mealTemplates",
    countKey: "mealTemplates",
    noun: "meal template",
    keyColumn: "id",
    columns: columnsOf<MealTemplateRow>()([
      "id",
      "user_id",
      "name",
      "foods",
      "sort_order",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: MealTemplateRow) => r.id,
    localKey: (l) => l.id,
    list: listMealTemplates,
    apply: (r) => applyServerMealTemplate(mealTemplateFromRow(r), r.updated_at),
    push: {
      toRow: mealTemplateToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      collision: {
        reassignId: (l, newId) =>
          reassignLocalRecordId("mealTemplates", l.id, newId),
      },
    },
  }),
  defineTable<RecipeRow, RecipeRecord>({
    table: "recipes",
    store: "recipes",
    countKey: "recipes",
    noun: "recipe",
    keyColumn: "id",
    columns: columnsOf<RecipeRow>()([
      "id",
      "user_id",
      "name",
      "ingredients",
      "cuisine",
      "notes",
      "sort_order",
      "share_slug",
      "share_visibility",
      "source_url",
      "servings",
      "prep_time_minutes",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r) => r.id,
    localKey: (l) => l.id,
    list: listRecipes,
    apply: (r) => applyServerRecipe(recipeFromRow(r), r.updated_at),
    push: {
      toRow: recipeToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      collision: {
        reassignId: (l, newId) => reassignLocalRecordId("recipes", l.id, newId),
      },
    },
  }),
  defineTable({
    table: "meal_schedules",
    store: "mealSchedules",
    countKey: "mealSchedules",
    noun: "meal schedule",
    keyColumn: "id",
    columns: columnsOf<MealScheduleRow>()([
      "id",
      "user_id",
      "name",
      "recipe_id",
      "meal_names",
      "start_date",
      "end_date",
      "days_of_week",
      "scale",
      "sort_order",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: MealScheduleRow) => r.id,
    localKey: (l) => l.id,
    list: listMealSchedules,
    apply: (r) => applyServerMealSchedule(mealScheduleFromRow(r), r.updated_at),
    push: {
      toRow: mealScheduleToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      collision: {
        reassignId: (l, newId) =>
          reassignLocalRecordId("mealSchedules", l.id, newId),
      },
    },
  }),
  defineTable({
    table: "supplements",
    store: "supplements",
    countKey: "supplements",
    noun: "supplement",
    keyColumn: "id",
    columns: columnsOf<SupplementRow>()([
      "id",
      "user_id",
      "name",
      "dose_label",
      "micros",
      "schedule",
      "notes",
      "sort_order",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: SupplementRow) => r.id,
    localKey: (l) => l.id,
    list: listSupplements,
    apply: (r) => applyServerSupplement(supplementFromRow(r), r.updated_at),
    push: {
      toRow: supplementToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      collision: {
        reassignId: (l, newId) =>
          reassignLocalRecordId("supplements", l.id, newId),
      },
    },
  }),
  defineTable({
    table: "pantry_items",
    store: "pantryItems",
    countKey: "pantryItems",
    noun: "pantry item",
    keyColumn: "id",
    columns: columnsOf<PantryItemRow>()([
      "id",
      "user_id",
      "name",
      "quantity",
      "unit",
      "note",
      "category",
      "density",
      "low_threshold",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: PantryItemRow) => r.id,
    localKey: (l) => l.id,
    list: listPantryItems,
    apply: (r) => applyServerPantryItem(pantryItemFromRow(r), r.updated_at),
    push: {
      toRow: pantryItemToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      collision: {
        reassignId: (l, newId) =>
          reassignLocalRecordId("pantryItems", l.id, newId),
      },
    },
  }),
  defineTable({
    table: "pantry_notifications",
    store: "pantryNotifications",
    countKey: "pantryNotifications",
    noun: "pantry notification",
    keyColumn: "id",
    columns: columnsOf<PantryNotificationRow>()([
      "id",
      "user_id",
      "type",
      "item_id",
      "item_name",
      "quantity",
      "unit",
      "read",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: PantryNotificationRow) => r.id,
    localKey: (l) => l.id,
    list: listPantryNotifications,
    apply: (r) =>
      applyServerPantryNotification(pantryNotificationFromRow(r), r.updated_at),
    push: {
      toRow: pantryNotificationToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      collision: {
        reassignId: (l, newId) =>
          reassignLocalRecordId("pantryNotifications", l.id, newId),
      },
    },
  }),
  defineTable({
    table: "favorite_stores",
    store: "favoriteStores",
    countKey: "favoriteStores",
    noun: "favorite store",
    keyColumn: "id",
    columns: columnsOf<FavoriteStoreRow>()([
      "id",
      "user_id",
      "name",
      "kind",
      "lat",
      "lon",
      "address",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: FavoriteStoreRow) => r.id,
    localKey: (l) => l.id,
    list: listFavoriteStores,
    apply: (r) =>
      applyServerFavoriteStore(favoriteStoreFromRow(r), r.updated_at),
    push: {
      toRow: favoriteStoreToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      // Favourite PKs are OSM keys (text), not UUIDs — no re-mint path.
      collision: "conflict",
    },
  }),
  defineTable({
    table: "favorite_foods",
    store: "favoriteFoods",
    countKey: "favoriteFoods",
    noun: "favorite food",
    keyColumn: "id",
    columns: columnsOf<FavoriteFoodRow>()([
      "id",
      "user_id",
      "name_key",
      "food",
      "portion",
      "created_at",
      "updated_at",
    ]),
    rowKey: (r: FavoriteFoodRow) => r.id,
    localKey: (l) => l.id,
    list: listFavoriteFoods,
    apply: (r) => applyServerFavoriteFood(favoriteFoodFromRow(r), r.updated_at),
    push: {
      toRow: favoriteFoodToRow,
      pk: (_userId, l) => ({ id: l.id }),
      create: "upsert",
      // UUID PKs (client-minted) — a collision is astronomically unlikely,
      // so treat it as a conflict rather than carrying a re-mint path.
      collision: "conflict",
    },
  }),
  // Pull-only: micronutrient profiles are written server-side by the
  // enrichment cron. The client never authors them locally in v1, so
  // there's no push counterpart. Keyed by `name_key` locally (the unique
  // identity both sides share).
  defineTable({
    table: "micronutrient_profiles",
    store: "micronutrientProfiles",
    countKey: "micronutrientProfiles",
    noun: "micronutrient profile",
    keyColumn: "name_key",
    columns: columnsOf<MicronutrientProfileRow>()([
      "user_id",
      "name_key",
      "values",
      "source",
      "source_code",
      "breakdown",
      "enriched_at",
      "updated_at",
    ]),
    rowKey: (r: MicronutrientProfileRow) => r.name_key,
    localKey: (l) => l.nameKey,
    list: listMicronutrientProfiles,
    apply: (r) =>
      applyServerMicronutrientProfile(
        micronutrientProfileFromRow(r),
        r.updated_at,
      ),
  }),
];

/** @internal The select list each pulled table uses, keyed by table name.
 *  Exported so a unit test can assert every column a push writes is also
 *  pulled back (otherwise a pull strips it and the next push nulls it). */
export const PULLED_COLUMNS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(SYNC_TABLES.map((t) => [t.table, t.columns]));

/** @internal Push one table on its own, with the same per-row isolation as
 *  a full run; throws {@link SyncIncompleteError} if any row failed.
 *  Exported for unit tests. Not part of the stable sync API. */
export async function pushSyncTable(
  table: string,
  supabase: SupabaseClient,
  userId: string,
  result: SyncResult,
): Promise<void> {
  const target = SYNC_TABLES.find((t) => t.table === table);
  if (!target) throw new Error(`unknown sync table: ${table}`);
  const run: SyncRun = { supabase, userId, result, errors: [] };
  await isolate(run.errors, () => target.push(run));
  if (run.errors.length > 0) throw new SyncIncompleteError(run.errors);
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
