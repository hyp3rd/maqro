import * as db from "@/lib/db";
import { __resetSyncStatusForTests, getSyncStatus } from "@/lib/sync-status";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pushCustomFoods,
  pushMealTemplates,
  triggerSync,
  type SyncResult,
} from "./index";

// Mock the IDB-backed db module so the sync code is exercised in
// isolation. Each test seeds the mocks with the rows it wants `list*`
// to return; assertions on `mark*Synced` / `upsert*` / `delete*`
// verify the per-row side effects.
vi.mock("@/lib/db", () => ({
  // Default `mockResolvedValue([])` so tests that don't exercise
  // body-measurements sync (most of them) don't have to remember
  // to prime this mock — the engine's `await listBodyMeasurements()`
  // gets a real array and the `.map` call after it works.
  listBodyMeasurements: vi.fn().mockResolvedValue([]),
  // Default-empty like listBodyMeasurements so pullBloodPressure's
  // `await listBloodPressure()` + `.map` works without per-test priming.
  listBloodPressure: vi.fn().mockResolvedValue([]),
  // Same default-empty rationale: pullFastSessions does
  // `await listFastSessions()` + `.map`, and most tests don't prime it.
  listFastSessions: vi.fn().mockResolvedValue([]),
  listCustomFoods: vi.fn(),
  listDailyLogs: vi.fn(),
  listMealTemplates: vi.fn(),
  listRecipes: vi.fn(),
  listMealSchedules: vi.fn().mockResolvedValue([]),
  // Same default-empty rationale as listBodyMeasurements: most tests
  // don't exercise pantry sync, so prime it with [] so the engine's
  // `await listPantryItems()` + `.map` doesn't blow up.
  listPantryItems: vi.fn().mockResolvedValue([]),
  // Same default-empty rationale: pantry-notification sync isn't
  // exercised by most tests, so prime the list helper with [].
  listPantryNotifications: vi.fn().mockResolvedValue([]),
  listFavoriteStores: vi.fn().mockResolvedValue([]),
  listFavoriteFoods: vi.fn().mockResolvedValue([]),
  listMicronutrientProfiles: vi.fn().mockResolvedValue([]),
  listWeightEntries: vi.fn(),
  // Default-empty like the other list helpers: most tests don't
  // exercise water sync, so the engine's `await listWaterIntake()`
  // + `.map` gets a real array.
  listWaterIntake: vi.fn().mockResolvedValue([]),
  getProfileRecord: vi.fn(),
  applyServerBodyMeasurement: vi.fn(),
  applyServerBloodPressure: vi.fn(),
  applyServerFastSession: vi.fn(),
  applyServerCustomFood: vi.fn(),
  applyServerDailyLog: vi.fn(),
  applyServerMealTemplate: vi.fn(),
  applyServerPantryItem: vi.fn(),
  applyServerPantryNotification: vi.fn(),
  applyServerFavoriteStore: vi.fn(),
  applyServerFavoriteFood: vi.fn(),
  applyServerMicronutrientProfile: vi.fn(),
  applyServerProfile: vi.fn(),
  applyServerRecipe: vi.fn(),
  applyServerMealSchedule: vi.fn(),
  applyServerWeightEntry: vi.fn(),
  applyServerWaterIntake: vi.fn(),
  markBodyMeasurementSynced: vi.fn(),
  markBloodPressureSynced: vi.fn(),
  markFastSessionSynced: vi.fn(),
  markCustomFoodSynced: vi.fn(),
  markDailyLogSynced: vi.fn(),
  markMealTemplateSynced: vi.fn(),
  markPantryItemSynced: vi.fn(),
  markPantryNotificationSynced: vi.fn(),
  markFavoriteStoreSynced: vi.fn(),
  markFavoriteFoodSynced: vi.fn(),
  markProfileSynced: vi.fn(),
  markRecipeSynced: vi.fn(),
  markMealScheduleSynced: vi.fn(),
  markWeightEntrySynced: vi.fn(),
  markWaterIntakeSynced: vi.fn(),
  upsertCustomFood: vi.fn(),
  upsertMealTemplate: vi.fn(),
  upsertPantryItem: vi.fn(),
  upsertPantryNotification: vi.fn(),
  upsertRecipe: vi.fn(),
  upsertMealSchedule: vi.fn(),
  // Pass A: UUID-collision recovery in the sync engine now uses
  // applyServerDeletion (silent local-only delete + clear tombstone)
  // instead of deleteX, so a re-mint cycle doesn't create a phantom
  // tombstone for the OLD UUID that never reached the server.
  applyServerDeletion: vi.fn(),
  // Tombstone-drain helpers (Pass A). Mocked so the sync's new
  // pushDeletions step is a no-op in these test scenarios.
  listDeletions: vi.fn().mockResolvedValue([]),
  clearDeletion: vi.fn(),
  deleteCustomFood: vi.fn(),
  deleteMealTemplate: vi.fn(),
  deleteRecipe: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

function newResult(): SyncResult {
  return {
    pushed: {
      profile: 0,
      dailyLogs: 0,
      weightEntries: 0,
      waterIntake: 0,
      bodyMeasurements: 0,
      bloodPressure: 0,
      fastSessions: 0,
      customFoods: 0,
      mealTemplates: 0,
      recipes: 0,
      mealSchedules: 0,
      pantryItems: 0,
      pantryNotifications: 0,
      favoriteStores: 0,
      favoriteFoods: 0,
      micronutrientProfiles: 0,
    },
    pulled: {
      profile: 0,
      dailyLogs: 0,
      weightEntries: 0,
      waterIntake: 0,
      bodyMeasurements: 0,
      bloodPressure: 0,
      fastSessions: 0,
      customFoods: 0,
      mealTemplates: 0,
      recipes: 0,
      mealSchedules: 0,
      pantryItems: 0,
      pantryNotifications: 0,
      favoriteStores: 0,
      favoriteFoods: 0,
      micronutrientProfiles: 0,
    },
    conflicts: 0,
    deletionsPushed: 0,
  };
}

/** Build a Supabase-shaped mock that captures the call chain so each
 *  test can assert what the push pipeline did. The new push path goes
 *  through one of two chains depending on whether the row has a
 *  serverUpdatedAt token:
 *
 *    - No token (insert):
 *      from(t).upsert(row).select("updated_at").abortSignal(sig).single()
 *
 *    - Has token (update with version check):
 *      from(t).update(row).eq(pk1).eq(pk2)…
 *        .eq("updated_at", base).select("updated_at").abortSignal(sig).maybeSingle()
 *
 *  Both terminate at a Promise<{ data, error }>. The mock takes
 *  per-operation handlers and a global call log. */
type OpResult = { data: unknown; error: unknown };

function makeSupabase(opts: {
  upsert?: (row: unknown) => OpResult;
  update?: (
    row: unknown,
    pkFields: Record<string, unknown>,
    base: string,
  ) => OpResult;
}) {
  const upsertCalls: unknown[] = [];
  const updateCalls: Array<{
    row: unknown;
    pkFields: Record<string, unknown>;
    base: string;
  }> = [];

  const sb = {
    from: () => ({
      // Pull chain. The sync engine does:
      //   .select(cols).eq("user_id", id).abortSignal(sig)
      // and optionally `.maybeSingle()` on the profile pull. We
      // default to "no rows" so a pull-only test (triggerSync with
      // empty stores) is a no-op rather than a hang.
      select: () => {
        const builder = {
          eq: () => builder,
          abortSignal: () => {
            const empty = Promise.resolve({ data: [], error: null });
            // The builder is itself thenable for `await q.eq(...).abortSignal(sig)` -
            // returns [] which the engine iterates and writes nothing.
            return Object.assign(empty, {
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            });
          },
        };
        return builder;
      },
      upsert: (row: unknown) => {
        upsertCalls.push(row);
        const r = opts.upsert
          ? opts.upsert(row)
          : { data: { updated_at: "2026-05-16T12:00:00Z" }, error: null };
        return {
          select: () => ({
            abortSignal: () => ({ single: () => Promise.resolve(r) }),
          }),
        };
      },
      update: (row: unknown) => {
        const pkFields: Record<string, unknown> = {};
        let base: string = "";
        const filterBuilder = {
          eq: (k: string, v: unknown) => {
            if (k === "updated_at") {
              base = v as string;
            } else {
              pkFields[k] = v;
            }
            return filterBuilder;
          },
          select: () => ({
            abortSignal: () => ({
              maybeSingle: () => {
                updateCalls.push({ row, pkFields, base });
                const r = opts.update
                  ? opts.update(row, pkFields, base)
                  : {
                      data: { updated_at: "2026-05-16T12:01:00Z" },
                      error: null,
                    };
                return Promise.resolve(r);
              },
            }),
          }),
        };
        return filterBuilder;
      },
    }),
  } as unknown as SupabaseClient;

  return { sb, upsertCalls, updateCalls };
}

describe("pushCustomFoods — per-row push with optimistic concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("INSERTs each new (no server token) row and marks it synced", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([
      {
        id: "a",
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        createdAt: 0,
      },
      {
        id: "b",
        name: "Oats",
        protein: 13,
        carbs: 67,
        fat: 7,
        calories: 389,
        createdAt: 0,
      },
    ]);
    const { sb, upsertCalls } = makeSupabase({});
    const result = newResult();

    await pushCustomFoods(sb, USER_ID, result);

    expect(result.pushed.customFoods).toBe(2);
    expect(result.conflicts).toBe(0);
    expect(upsertCalls).toHaveLength(2);
    expect(vi.mocked(db.markCustomFoodSynced)).toHaveBeenCalledTimes(2);
  });

  it("UPDATEs each existing (server token present) row with .eq('updated_at', base)", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([
      {
        id: "a",
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        createdAt: 0,
        localUpdatedAt: "2026-05-16T13:00:00Z",
        serverUpdatedAt: "2026-05-16T12:00:00Z",
      },
    ]);
    const { sb, updateCalls } = makeSupabase({});
    const result = newResult();

    await pushCustomFoods(sb, USER_ID, result);

    expect(result.pushed.customFoods).toBe(1);
    expect(updateCalls).toHaveLength(1);
    // The version-check filter must carry the row's old serverUpdatedAt.
    expect(updateCalls[0].base).toBe("2026-05-16T12:00:00Z");
    expect(updateCalls[0].pkFields).toEqual({ id: "a" });
  });

  it("treats zero rows affected (stale base) as a CONFLICT and increments counter", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([
      {
        id: "a",
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        createdAt: 0,
        localUpdatedAt: "2026-05-16T13:00:00Z",
        serverUpdatedAt: "2026-05-16T12:00:00Z",
      },
    ]);
    const { sb } = makeSupabase({
      // Simulate "another device pushed first" — Postgres returns 0
      // rows because our base no longer matches the row's updated_at.
      update: () => ({ data: null, error: null }),
    });
    const result = newResult();

    await pushCustomFoods(sb, USER_ID, result);

    expect(result.pushed.customFoods).toBe(0);
    expect(result.conflicts).toBe(1);
    expect(vi.mocked(db.markCustomFoodSynced)).not.toHaveBeenCalled();
  });

  it("skips clean rows (localUpdatedAt === serverUpdatedAt) to avoid no-op pushes", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([
      {
        id: "a",
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        createdAt: 0,
        localUpdatedAt: "2026-05-16T12:00:00Z",
        serverUpdatedAt: "2026-05-16T12:00:00Z",
      },
    ]);
    const { sb, upsertCalls, updateCalls } = makeSupabase({});
    const result = newResult();

    await pushCustomFoods(sb, USER_ID, result);

    expect(result.pushed.customFoods).toBe(0);
    expect(upsertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("returns silently when there are no local rows", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([]);
    const { sb, upsertCalls, updateCalls } = makeSupabase({});
    const result = newResult();

    await pushCustomFoods(sb, USER_ID, result);

    expect(result.pushed.customFoods).toBe(0);
    expect(upsertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("re-mints colliding UUIDs on 42501 and retries (RLS row-owned-by-another-user recovery)", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([
      {
        id: "collides",
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        createdAt: 0,
      },
    ]);
    let firstAttempt = true;
    const { sb } = makeSupabase({
      upsert: () => {
        if (firstAttempt) {
          firstAttempt = false;
          // First UUID collides with another user's row → 42501.
          return { data: null, error: { code: "42501" } };
        }
        // Retry with re-minted UUID succeeds.
        return { data: { updated_at: "2026-05-16T12:00:00Z" }, error: null };
      },
    });
    const result = newResult();

    await pushCustomFoods(sb, USER_ID, result);

    expect(result.pushed.customFoods).toBe(1);
    expect(vi.mocked(db.upsertCustomFood)).toHaveBeenCalledTimes(1);
    // Re-mint path uses applyServerDeletion (no tombstone) — see the
    // mock comment above for the why.
    expect(vi.mocked(db.applyServerDeletion)).toHaveBeenCalledWith(
      "customFoods",
      "collides",
    );
  });

  it("rethrows non-42501 errors instead of swallowing them", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([
      {
        id: "a",
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        createdAt: 0,
      },
    ]);
    const { sb } = makeSupabase({
      upsert: () => ({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      }),
    });
    const result = newResult();

    await expect(pushCustomFoods(sb, USER_ID, result)).rejects.toThrow(
      /duplicate key/,
    );
  });
});

describe("pushMealTemplates — same per-row semantics as customFoods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-mints colliding UUIDs on 42501 and retries", async () => {
    vi.mocked(db.listMealTemplates).mockResolvedValue([
      {
        id: "collides",
        name: "Greek bowl",
        foods: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    let firstAttempt = true;
    const { sb } = makeSupabase({
      upsert: () => {
        if (firstAttempt) {
          firstAttempt = false;
          return { data: null, error: { code: "42501" } };
        }
        return { data: { updated_at: "2026-05-16T12:00:00Z" }, error: null };
      },
    });
    const result = newResult();

    await pushMealTemplates(sb, USER_ID, result);

    expect(result.pushed.mealTemplates).toBe(1);
    expect(vi.mocked(db.upsertMealTemplate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.applyServerDeletion)).toHaveBeenCalledWith(
      "mealTemplates",
      "collides",
    );
  });
});

describe("triggerSync — conflict status flip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSyncStatusForTests();
  });
  afterEach(() => {
    __resetSyncStatusForTests();
  });

  it("flips status to 'conflict' when runInitialSync returns conflicts > 0", async () => {
    // Seed one custom_food whose push will be rejected (stale base).
    // Everything else is empty so the rest of the sync is a no-op.
    vi.mocked(db.listCustomFoods).mockResolvedValue([
      {
        id: "a",
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        createdAt: 0,
        localUpdatedAt: "2026-05-16T13:00:00Z",
        serverUpdatedAt: "2026-05-16T12:00:00Z",
      },
    ]);
    vi.mocked(db.listDailyLogs).mockResolvedValue([]);
    vi.mocked(db.listWeightEntries).mockResolvedValue([]);
    vi.mocked(db.listMealTemplates).mockResolvedValue([]);
    vi.mocked(db.listRecipes).mockResolvedValue([]);
    vi.mocked(db.getProfileRecord).mockResolvedValue(null);

    const { sb } = makeSupabase({
      // Stale base → server returns 0 rows updated → engine logs a
      // conflict.
      update: () => ({ data: null, error: null }),
    });

    const result = await triggerSync(sb, USER_ID);
    expect(result?.conflicts).toBe(1);

    const status = getSyncStatus();
    expect(status.state).toBe("conflict");
    if (status.state === "conflict") {
      expect(status.count).toBe(1);
    }
  });

  it("flips status to 'synced' when there are no conflicts", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([]);
    vi.mocked(db.listDailyLogs).mockResolvedValue([]);
    vi.mocked(db.listWeightEntries).mockResolvedValue([]);
    vi.mocked(db.listMealTemplates).mockResolvedValue([]);
    vi.mocked(db.listRecipes).mockResolvedValue([]);
    vi.mocked(db.getProfileRecord).mockResolvedValue(null);

    const { sb } = makeSupabase({});

    await triggerSync(sb, USER_ID);

    expect(getSyncStatus().state).toBe("synced");
  });
});

describe("runInitialSync — pull-then-push order (incognito-clobber fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSyncStatusForTests();
  });

  it("pulls profile before any push runs", async () => {
    // The data-loss bug this guards: when push runs first, an
    // incognito session's just-saved `defaultProfile` gets `upsert`ed
    // over the server's real profile. With pull-first, the server's
    // real profile lands in IDB before any push has a chance to
    // upload local junk.
    vi.mocked(db.listCustomFoods).mockResolvedValue([]);
    vi.mocked(db.listDailyLogs).mockResolvedValue([]);
    vi.mocked(db.listWeightEntries).mockResolvedValue([]);
    vi.mocked(db.listMealTemplates).mockResolvedValue([]);
    vi.mocked(db.listRecipes).mockResolvedValue([]);
    vi.mocked(db.getProfileRecord).mockResolvedValue(null);

    // Track the order of high-level call types by inspecting which
    // `from(<table>)` chain was invoked first.
    const callOrder: string[] = [];
    const sb = {
      from: (table: string) => ({
        select: () => {
          callOrder.push(`select:${table}`);
          const builder = {
            eq: () => builder,
            abortSignal: () => {
              const empty = Promise.resolve({ data: [], error: null });
              return Object.assign(empty, {
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              });
            },
          };
          return builder;
        },
        upsert: () => {
          callOrder.push(`upsert:${table}`);
          return {
            select: () => ({
              abortSignal: () => ({
                single: () =>
                  Promise.resolve({
                    data: { updated_at: "2026-05-16T12:00:00Z" },
                    error: null,
                  }),
              }),
            }),
          };
        },
        update: () => {
          callOrder.push(`update:${table}`);
          const fb = {
            eq: () => fb,
            select: () => ({
              abortSignal: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
          return fb;
        },
      }),
    } as unknown as SupabaseClient;

    await triggerSync(sb, USER_ID);

    // The first call should be a SELECT (pull), not an upsert/update.
    expect(callOrder[0]?.startsWith("select:")).toBe(true);
    // No upserts/updates at all in this scenario (nothing local).
    expect(callOrder.some((c) => c.startsWith("upsert:"))).toBe(false);
    expect(callOrder.some((c) => c.startsWith("update:"))).toBe(false);
  });

  it("notifies the data bus when a pull writes a fresh profile", async () => {
    // After pull writes the server's data into IDB, the hooks must
    // re-hydrate React state — otherwise the next debounced auto-save
    // would push the stale React-side default and overwrite the row
    // we just pulled.
    vi.mocked(db.listCustomFoods).mockResolvedValue([]);
    vi.mocked(db.listDailyLogs).mockResolvedValue([]);
    vi.mocked(db.listWeightEntries).mockResolvedValue([]);
    vi.mocked(db.listMealTemplates).mockResolvedValue([]);
    vi.mocked(db.listRecipes).mockResolvedValue([]);
    vi.mocked(db.getProfileRecord).mockResolvedValue(null);

    const { subscribeDataChanged } = await import("./data-bus");
    const busCb = vi.fn();
    const unsub = subscribeDataChanged("profile", busCb);

    // Supabase mock: profile pull returns a real row.
    const sb = {
      from: (table: string) => ({
        select: () => {
          const builder = {
            eq: () => builder,
            abortSignal: () => {
              if (table === "profiles") {
                const p = Promise.resolve({
                  data: {
                    user_id: USER_ID,
                    payload: { weight: 80 },
                    updated_at: "2026-05-16T12:00:00Z",
                  },
                  error: null,
                });
                return Object.assign(p, {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        user_id: USER_ID,
                        payload: { weight: 80 },
                        updated_at: "2026-05-16T12:00:00Z",
                      },
                      error: null,
                    }),
                });
              }
              const empty = Promise.resolve({ data: [], error: null });
              return Object.assign(empty, {
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              });
            },
          };
          return builder;
        },
      }),
    } as unknown as SupabaseClient;

    await triggerSync(sb, USER_ID);

    expect(vi.mocked(db.applyServerProfile)).toHaveBeenCalledTimes(1);
    expect(busCb).toHaveBeenCalledTimes(1);

    unsub();
  });
});
