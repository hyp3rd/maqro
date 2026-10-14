import { MfaRequiredError } from "@/lib/auth/session-assurance";
import { signOutAndClearLocal } from "@/lib/auth/sign-out";
import * as db from "@/lib/db";
import {
  __resetSyncStatusForTests,
  getSyncStatus,
  setSyncConflict,
} from "@/lib/sync-status";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  discardPendingChanges,
  pushSyncTable,
  resolveConflictsKeepingLocal,
  triggerSync,
  type SyncResult,
} from "./index";

const pushCustomFoods = (
  sb: SupabaseClient,
  userId: string,
  result: SyncResult,
) => pushSyncTable("custom_foods", sb, userId, result);
const pushMealTemplates = (
  sb: SupabaseClient,
  userId: string,
  result: SyncResult,
) => pushSyncTable("meal_templates", sb, userId, result);
const pushFavoriteStores = (
  sb: SupabaseClient,
  userId: string,
  result: SyncResult,
) => pushSyncTable("favorite_stores", sb, userId, result);

vi.mock("@/lib/auth/sign-out", () => ({ signOutAndClearLocal: vi.fn() }));

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
  // Default-empty so the supplement-library sync's `await listSupplements()`
  // + `.map` works without per-test priming (mirrors listMealSchedules).
  listSupplements: vi.fn().mockResolvedValue([]),
  // Same default-empty rationale as listWaterIntake: most tests don't
  // exercise supplement-intake sync.
  listSupplementIntake: vi.fn().mockResolvedValue([]),
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
  applyServerSupplement: vi.fn(),
  applyServerSupplementIntake: vi.fn(),
  applyServerWeightEntry: vi.fn(),
  applyServerWaterIntake: vi.fn(),
  markProfileSynced: vi.fn(),
  // Generic compare-and-set mark (one helper for every multi-row store).
  markRecordSynced: vi.fn().mockResolvedValue("synced"),
  // Pure helper — the real definition, so dirty detection is exercised.
  isDirtyRecord: (row: {
    localUpdatedAt?: string;
    serverUpdatedAt?: string | null;
  }) => !row.serverUpdatedAt || row.localUpdatedAt !== row.serverUpdatedAt,
  // Remote-delete reconciliation after each complete pull: nothing to do
  // against the (empty) mocked stores.
  reconcileServerAbsences: vi
    .fn()
    .mockResolvedValue({ removed: [], requeued: [] }),
  // UUID-collision recovery: atomically move the row to the new id and
  // return it (mirrors the real helper's contract; the fields are the
  // minimum the custom-food / template mappers read).
  reassignLocalRecordId: vi.fn(
    async (_store: string, _oldId: string, newId: string) => ({
      id: newId,
      name: "re-minted",
      foods: [],
      createdAt: 0,
      updatedAt: 0,
      serverUpdatedAt: null,
    }),
  ),
  rebaseDirtyRecord: vi.fn(),
  rebaseDirtyProfile: vi.fn(),
  // Tombstone-drain helpers (Pass A). Mocked so the sync's new
  // pushDeletions step is a no-op in these test scenarios.
  listDeletions: vi.fn().mockResolvedValue([]),
  clearDeletion: vi.fn(),
  clearAllStores: vi.fn(),
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
    },
    pulled: {
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
    },
    conflicts: [],
    deletionsPushed: 0,
  };
}

/** Build a Supabase-shaped mock that captures the call chain so each
 *  test can assert what the push pipeline did. The new push path goes
 *  through one of two chains depending on whether the row has a
 *  serverUpdatedAt token:
 *
 *    - No token (create): `upsert` for client-minted UUID keys, `insert`
 *      for natural keys (see `CreateMode`):
 *      from(t).upsert(row).select("updated_at").abortSignal(sig).single()
 *      from(t).insert(row).select("updated_at").abortSignal(sig).single()
 *
 *    - Has token (update with version check):
 *      from(t).update(row).eq(pk1).eq(pk2)…
 *        .eq("updated_at", base).select("updated_at").abortSignal(sig).maybeSingle()
 *
 *  Both terminate at a Promise<{ data, error }>. The mock takes
 *  per-operation handlers and a global call log. */
type OpResult = { data: unknown; error: unknown };

/** `auth` surface the sync engine's assurance check reads. The user has a
 *  verified TOTP factor; `aal2` has proved it, `mfa-pending` (aal1) hasn't —
 *  the state RLS rejects (migration 0079). */
function fakeAuth(session: "aal2" | "mfa-pending") {
  return {
    mfa: {
      getAuthenticatorAssuranceLevel: async () => ({
        data: {
          currentLevel: session === "aal2" ? "aal2" : "aal1",
          nextLevel: "aal2",
          currentAuthenticationMethods: [{ method: "otp" }],
        },
        error: null,
      }),
    },
    getUser: async () => ({
      data: {
        user: {
          id: USER_ID,
          factors: [{ id: "f1", factor_type: "totp", status: "verified" }],
        },
      },
      error: null,
    }),
  };
}

function makeSupabase(opts: {
  upsert?: (row: unknown) => OpResult;
  insert?: (row: unknown) => OpResult;
  update?: (
    row: unknown,
    pkFields: Record<string, unknown>,
    base: string,
  ) => OpResult;
  /** The session's assurance (see `fakeAuth`). Default `aal2`. */
  session?: "aal2" | "mfa-pending";
}) {
  const fromCalls: string[] = [];
  const upsertCalls: unknown[] = [];
  const insertCalls: unknown[] = [];
  const updateCalls: Array<{
    row: unknown;
    pkFields: Record<string, unknown>;
    base: string;
  }> = [];

  const sb = {
    auth: fakeAuth(opts.session ?? "aal2"),
    from: (table: string) => (
      fromCalls.push(table),
      {
        // Pull chain. The sync engine does:
        //   .select(cols).eq("user_id", id).abortSignal(sig)
        // (plus .gt/.order/.limit for keyset pages) and optionally
        // `.maybeSingle()` on the profile pull. We default to "no rows" so
        // a pull-only test (triggerSync with empty stores) is a no-op
        // rather than a hang.
        select: () => {
          const builder = {
            eq: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => builder,
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
        insert: (row: unknown) => {
          insertCalls.push(row);
          const r = opts.insert
            ? opts.insert(row)
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
      }
    ),
  } as unknown as SupabaseClient;

  return { sb, fromCalls, upsertCalls, insertCalls, updateCalls };
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
    expect(result.conflicts).toEqual([]);
    expect(upsertCalls).toHaveLength(2);
    expect(vi.mocked(db.markRecordSynced)).toHaveBeenCalledTimes(2);
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
    expect(result.conflicts).toHaveLength(1);
    expect(vi.mocked(db.markRecordSynced)).not.toHaveBeenCalled();
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
    // Re-mint moves the row to a fresh id atomically (no tombstone for
    // the old id — it never belonged to this user server-side).
    expect(vi.mocked(db.reassignLocalRecordId)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.reassignLocalRecordId)).toHaveBeenCalledWith(
      "customFoods",
      "collides",
      expect.any(String),
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
    expect(vi.mocked(db.reassignLocalRecordId)).toHaveBeenCalledWith(
      "mealTemplates",
      "collides",
      expect.any(String),
    );
  });
});

describe("pushFavoriteStores — per-user key (migration 0077)", () => {
  // The id is a shared OSM key ("node/123"): two users may favourite the same
  // store, so the server row is keyed (user_id, id) and every push must
  // address the caller's row by both columns. Within one user that key is a
  // natural key two devices can create independently, so a never-synced
  // favourite is created with a plain INSERT, never an upsert over a peer's.
  const STORE = {
    id: "node/123",
    name: "Corner Market",
    kind: "supermarket",
    lat: 45.1,
    lon: 9.2,
    createdAt: 0,
    updatedAt: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    // Back to the module mock's default so later suites' full syncs don't
    // see this suite's favourite.
    vi.mocked(db.listFavoriteStores).mockResolvedValue([]);
  });

  it("inserts a new favourite with the caller's user_id in the row", async () => {
    vi.mocked(db.listFavoriteStores).mockResolvedValue([STORE]);
    const { sb, insertCalls, upsertCalls } = makeSupabase({});
    const result = newResult();

    await pushFavoriteStores(sb, USER_ID, result);

    expect(insertCalls).toEqual([
      expect.objectContaining({ id: "node/123", user_id: USER_ID }),
    ]);
    expect(upsertCalls).toEqual([]);
    expect(result.pushed.favoriteStores).toBe(1);
    expect(vi.mocked(db.markRecordSynced)).toHaveBeenCalledWith(
      "favoriteStores",
      "node/123",
      "2026-05-16T12:00:00Z",
      undefined,
    );
  });

  it("filters an update on (user_id, id), not the shared OSM key alone", async () => {
    vi.mocked(db.listFavoriteStores).mockResolvedValue([
      {
        ...STORE,
        localUpdatedAt: "2026-05-16T13:00:00Z",
        serverUpdatedAt: "2026-05-16T12:00:00Z",
      },
    ]);
    const { sb, updateCalls } = makeSupabase({});
    const result = newResult();

    await pushFavoriteStores(sb, USER_ID, result);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.pkFields).toEqual({
      user_id: USER_ID,
      id: "node/123",
    });
    expect(updateCalls[0]!.base).toBe("2026-05-16T12:00:00Z");
    expect(result.pushed.favoriteStores).toBe(1);
  });

  it("reports the caller's other device already holding the key as a conflict, not an overwrite", async () => {
    vi.mocked(db.listFavoriteStores).mockResolvedValue([STORE]);
    const { sb, upsertCalls } = makeSupabase({
      insert: () => ({
        data: null,
        error: { code: "23505", message: "duplicate key" },
      }),
    });
    const result = newResult();

    await pushFavoriteStores(sb, USER_ID, result);

    expect(upsertCalls).toEqual([]);
    expect(result.conflicts).toEqual([
      { table: "favorite_stores", key: "node/123" },
    ]);
    expect(result.pushed.favoriteStores).toBe(0);
    expect(vi.mocked(db.markRecordSynced)).not.toHaveBeenCalled();
  });

  it("surfaces a 42501 as a rejection: with user_id in the key it can't be another user's row", async () => {
    vi.mocked(db.listFavoriteStores).mockResolvedValue([STORE]);
    const { sb } = makeSupabase({
      insert: () => ({ data: null, error: { code: "42501" } }),
    });
    const result = newResult();

    await expect(pushFavoriteStores(sb, USER_ID, result)).rejects.toThrow(
      /row-level security rejected the insert \(42501\)/,
    );
    expect(result.conflicts).toEqual([]);
    expect(vi.mocked(db.markRecordSynced)).not.toHaveBeenCalled();
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
    expect(result?.conflicts).toHaveLength(1);

    const status = getSyncStatus();
    expect(status.state).toBe("conflict");
    if (status.state === "conflict") {
      expect(status.rows).toHaveLength(1);
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
      auth: fakeAuth("aal2"),
      from: (table: string) => ({
        select: () => {
          callOrder.push(`select:${table}`);
          const builder = {
            eq: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => builder,
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
    vi.mocked(db.applyServerProfile).mockResolvedValue("applied");

    const { subscribeDataChanged } = await import("./data-bus");
    const busCb = vi.fn();
    const unsub = subscribeDataChanged("profile", busCb);

    // Supabase mock: profile pull returns a real row.
    const sb = {
      auth: fakeAuth("aal2"),
      from: (table: string) => ({
        select: () => {
          const builder = {
            eq: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => builder,
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

  it("treats a server placeholder profile ({} payload) as no profile and still pushes the local one", async () => {
    // Migration 0074 guarantees a profiles row from sign-up on, created
    // with an empty payload. A guest who filled in their profile before
    // signing up has a local profile with no server token: the pull must
    // not overwrite it with `{}`, and the push must replace the placeholder
    // row with it. A never-synced profile is created with a plain INSERT
    // (the user id is a natural key a peer device can create too), so the
    // placeholder answers 23505; it is then replaced through a versioned
    // UPDATE on the placeholder's own token.
    vi.mocked(db.listCustomFoods).mockResolvedValue([]);
    vi.mocked(db.listDailyLogs).mockResolvedValue([]);
    vi.mocked(db.listWeightEntries).mockResolvedValue([]);
    vi.mocked(db.listMealTemplates).mockResolvedValue([]);
    vi.mocked(db.listRecipes).mockResolvedValue([]);
    vi.mocked(db.getProfileRecord).mockResolvedValue({
      weight: 72,
      localUpdatedAt: "2026-05-16T11:00:00Z",
      serverUpdatedAt: null,
    } as unknown as Awaited<ReturnType<typeof db.getProfileRecord>>);

    const placeholder = {
      user_id: USER_ID,
      payload: {},
      updated_at: "2026-05-16T12:00:00Z",
    };
    const writes: Array<{
      table: string;
      op: "insert" | "upsert" | "update";
      row: unknown;
      base?: unknown;
    }> = [];
    const sb = {
      auth: fakeAuth("aal2"),
      from: (table: string) => ({
        select: () => {
          const builder = {
            eq: () => builder,
            gt: () => builder,
            order: () => builder,
            limit: () => builder,
            abortSignal: () => {
              const rows = table === "profiles" ? [placeholder] : [];
              return Object.assign(
                Promise.resolve({ data: rows, error: null }),
                {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: table === "profiles" ? placeholder : null,
                      error: null,
                    }),
                },
              );
            },
          };
          return builder;
        },
        insert: (row: unknown) => {
          writes.push({ table, op: "insert", row });
          return {
            select: () => ({
              abortSignal: () => ({
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: { code: "23505", message: "duplicate key" },
                  }),
              }),
            }),
          };
        },
        upsert: (row: unknown) => {
          writes.push({ table, op: "upsert", row });
          return {
            select: () => ({
              abortSignal: () => ({
                single: () =>
                  Promise.resolve({ data: null, error: { code: "XX000" } }),
              }),
            }),
          };
        },
        update: (row: unknown) => {
          let base: unknown;
          const filter = {
            eq: (column: string, value: unknown) => {
              if (column === "updated_at") base = value;
              return filter;
            },
            select: () => ({
              abortSignal: () => ({
                maybeSingle: () => {
                  writes.push({ table, op: "update", row, base });
                  return Promise.resolve({
                    data: { updated_at: "2026-05-16T12:05:00Z" },
                    error: null,
                  });
                },
              }),
            }),
          };
          return filter;
        },
      }),
    } as unknown as SupabaseClient;

    await triggerSync(sb, USER_ID);

    expect(vi.mocked(db.applyServerProfile)).not.toHaveBeenCalled();
    const row = { user_id: USER_ID, payload: { weight: 72 } };
    expect(writes).toEqual([
      { table: "profiles", op: "insert", row },
      { table: "profiles", op: "update", row, base: placeholder.updated_at },
    ]);
    expect(vi.mocked(db.markProfileSynced)).toHaveBeenCalledWith(
      "2026-05-16T12:05:00Z",
      "2026-05-16T11:00:00Z",
    );
  });
});

describe("MFA-enrolled session that hasn't proved the second factor", () => {
  const colliding = {
    id: "local-id",
    name: "Tofu",
    protein: 8,
    carbs: 2,
    fat: 4,
    calories: 76,
    createdAt: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetSyncStatusForTests();
  });
  afterEach(() => {
    __resetSyncStatusForTests();
  });

  it("triggerSync never touches the Data API and keeps local data", async () => {
    const { sb, fromCalls } = makeSupabase({ session: "mfa-pending" });

    await expect(triggerSync(sb, USER_ID)).rejects.toBeInstanceOf(
      MfaRequiredError,
    );

    // No pull (it would read back empty under RLS), no push, no tombstones.
    expect(fromCalls).toHaveLength(0);
    expect(vi.mocked(db.listDeletions)).not.toHaveBeenCalled();
    // Owing the second factor is not a dead session: nothing is wiped.
    expect(vi.mocked(signOutAndClearLocal)).not.toHaveBeenCalled();
    expect(getSyncStatus().state).toBe("error");
  });

  it("discardPendingChanges refuses before wiping the local stores", async () => {
    const { sb, fromCalls } = makeSupabase({ session: "mfa-pending" });

    await expect(discardPendingChanges(sb, USER_ID)).rejects.toBeInstanceOf(
      MfaRequiredError,
    );
    expect(vi.mocked(db.clearAllStores)).not.toHaveBeenCalled();
    expect(fromCalls).toHaveLength(0);
  });

  it("resolveConflictsKeepingLocal refuses before the rebase reads", async () => {
    // Under RLS the rebase SELECT would come back empty, which reads as
    // "the server row is gone" and would clear the reviewed rows' bases.
    setSyncConflict([{ table: "daily_logs", key: "2026-05-16" }]);
    const { sb, fromCalls } = makeSupabase({ session: "mfa-pending" });

    await expect(
      resolveConflictsKeepingLocal(sb, USER_ID),
    ).rejects.toBeInstanceOf(MfaRequiredError);
    expect(fromCalls).toHaveLength(0);
    expect(vi.mocked(db.rebaseDirtyRecord)).not.toHaveBeenCalled();
    expect(vi.mocked(signOutAndClearLocal)).not.toHaveBeenCalled();
  });

  it("an RLS 42501 is not mistaken for a UUID collision (no re-mint)", async () => {
    vi.mocked(db.listCustomFoods).mockResolvedValue([colliding]);
    const { sb, upsertCalls } = makeSupabase({
      session: "mfa-pending",
      // What the restrictive MFA policy answers for the insert.
      upsert: () => ({ data: null, error: { code: "42501" } }),
    });

    await expect(
      pushCustomFoods(sb, USER_ID, newResult()),
    ).rejects.toBeInstanceOf(MfaRequiredError);

    // No re-mint: the row keeps its id (the engine re-mints through
    // `reassignLocalRecordId`) and nothing is retried.
    expect(upsertCalls).toHaveLength(1);
    expect(vi.mocked(db.reassignLocalRecordId)).not.toHaveBeenCalled();
    expect(vi.mocked(db.markRecordSynced)).not.toHaveBeenCalled();
  });
});
