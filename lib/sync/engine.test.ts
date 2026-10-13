/**
 * @vitest-environment jsdom
 */
// End-to-end sync-engine invariants against a REAL IndexedDB (fake-indexeddb)
// and an in-memory fake of the PostgREST surface the engine uses. Unlike
// index.test.ts (which mocks `@/lib/db`), these exercise the transactions in
// `lib/db.ts` together with the engine, so they catch the cross-layer races:
// a pull clobbering a dirty row, a mark-synced swallowing a mid-push edit,
// a rejected row aborting the run, a remote delete never reaching this
// device, a pull dropping columns its push later writes as NULL.
import type { Meal } from "@/components/macro/types";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-05-16";

type Row = Record<string, unknown>;
type PgError = { code?: string; message: string; details?: string };
type Op = "select" | "upsert" | "update" | "delete";
type Filter = { column: string; op: "eq" | "gt" | "in"; value: unknown };

/** Natural key per table — what an upsert conflicts on. */
const KEY_COLUMNS: Record<string, string[]> = {
  profiles: ["user_id"],
  daily_logs: ["user_id", "date"],
  weight_history: ["user_id", "date"],
  water_intake: ["user_id", "date"],
  supplement_intake: ["user_id", "date"],
  body_measurements: ["user_id", "date"],
  blood_pressure: ["user_id", "date"],
  fast_sessions: ["user_id", "id"],
  micronutrient_profiles: ["user_id", "name_key"],
};

/** In-memory stand-in for the PostgREST + Realtime surface the sync engine
 *  touches. Writes stamp a fresh, strictly increasing `updated_at` (like the
 *  `set_updated_at` trigger) and store the body as it crosses the wire
 *  (JSON: `undefined` fields dropped); reads honour `max_rows` like PostgREST
 *  and project the selected columns — a stored-but-unset column comes back
 *  as `null`, and a pull that forgets a column really does get `undefined`
 *  back. */
class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  maxRows = 1000;
  /** Return an error to fail an operation, or null to let it through. */
  fail: (table: string, op: Op, row: Row | undefined) => PgError | null = () =>
    null;
  /** Awaited after a write lands server-side, before its response reaches
   *  the client — i.e. "while the push is in flight". */
  onWrite: (table: string, op: Op) => Promise<void> | void = () => {};
  readonly attempts: Array<{ table: string; op: Op }> = [];
  private readonly listeners: Array<{
    table: string;
    cb: (payload: unknown) => void;
  }> = [];
  private tick = 0;

  nextTimestamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 4, 16, 12, 0, 0) + this.tick * 1000)
      .toISOString()
      .replace("Z", "+00:00");
  }

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  seed(table: string, row: Row): Row {
    const stored = { updated_at: this.nextTimestamp(), ...row };
    this.rows(table).push(stored);
    return stored;
  }

  find(table: string, match: Row): Row | undefined {
    return this.rows(table).find((r) =>
      Object.entries(match).every(([k, v]) => r[k] === v),
    );
  }

  /** Deliver a postgres_changes payload to every channel on `table`. */
  emit(table: string, payload: unknown): void {
    for (const l of this.listeners) if (l.table === table) l.cb(payload);
  }

  client(): SupabaseClient {
    // Arrow functions keep `this` bound to the server.
    return {
      from: (table: string) => new FakeQuery(this, table),
      channel: () => {
        const channel = {
          on: (
            _event: string,
            opts: { table: string },
            cb: (payload: unknown) => void,
          ) => {
            this.listeners.push({ table: opts.table, cb });
            return channel;
          },
          subscribe: () => channel,
        };
        return channel;
      },
      removeChannel: () => Promise.resolve("ok"),
    } as unknown as SupabaseClient;
  }
}

/** A request body as PostgREST receives it (supabase-js sends JSON). */
function wire(row: Row): Row {
  return JSON.parse(JSON.stringify(row)) as Row;
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: Op = "select";
  private columns: string | undefined;
  private payload: Row | undefined;
  private readonly filters: Filter[] = [];
  private orderColumn: string | undefined;
  private limitRows: number | undefined;

  constructor(
    private readonly server: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns?: string) {
    if (this.op === "select") this.columns = columns;
    return this;
  }
  upsert(row: Row) {
    this.op = "upsert";
    this.payload = wire(row);
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.payload = wire(row);
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push({ column, op: "gt", value });
    return this;
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ column, op: "in", value });
    return this;
  }
  order(column: string) {
    this.orderColumn = column;
    return this;
  }
  limit(rows: number) {
    this.limitRows = rows;
    return this;
  }
  abortSignal() {
    return this;
  }
  single() {
    return this.execute("one");
  }
  maybeSingle() {
    return this.execute("maybe");
  }
  then<A = { data: unknown; error: unknown }, B = never>(
    onFulfilled?:
      ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute("many").then(onFulfilled, onRejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.column];
      if (f.op === "eq") return v === f.value;
      if (f.op === "gt") return String(v) > String(f.value);
      return (f.value as unknown[]).includes(v);
    });
  }

  private project(row: Row): Row {
    if (!this.columns || this.columns === "*") return { ...row };
    const out: Row = {};
    for (const c of this.columns.split(",").map((s) => s.trim())) {
      out[c] = row[c] ?? null;
    }
    return out;
  }

  private async execute(
    mode: "one" | "maybe" | "many",
  ): Promise<{ data: unknown; error: unknown }> {
    const { server, table } = this;
    server.attempts.push({ table, op: this.op });
    const failure = server.fail(table, this.op, this.payload);
    if (failure) return { data: null, error: failure };
    const rows = server.rows(table);

    if (this.op === "select") {
      let found = rows.filter((r) => this.matches(r));
      if (this.orderColumn) {
        const col = this.orderColumn;
        found = [...found].sort((a, b) =>
          String(a[col]) < String(b[col]) ? -1 : 1,
        );
      }
      found = found
        .slice(0, Math.min(this.limitRows ?? Infinity, server.maxRows))
        .map((r) => this.project(r));
      if (mode === "many") return { data: found, error: null };
      return { data: found[0] ?? null, error: null };
    }

    if (this.op === "delete") {
      server.tables[table] = rows.filter((r) => !this.matches(r));
      return { data: null, error: null };
    }

    const updatedAt = server.nextTimestamp();
    let written: Row | undefined;
    if (this.op === "upsert") {
      const keys = KEY_COLUMNS[table] ?? ["id"];
      const payload = this.payload ?? {};
      written = rows.find((r) => keys.every((k) => r[k] === payload[k]));
      if (written) Object.assign(written, payload, { updated_at: updatedAt });
      else {
        written = { ...payload, updated_at: updatedAt };
        rows.push(written);
      }
    } else {
      written = rows.find((r) => this.matches(r));
      if (written) {
        Object.assign(written, this.payload, { updated_at: updatedAt });
      }
    }
    if (written) await server.onWrite(table, this.op);
    const data = written ? { updated_at: written.updated_at } : null;
    return { data, error: null };
  }
}

async function setup() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  const db = await import("@/lib/db");
  const sync = await import("./index");
  const status = await import("@/lib/sync-status");
  const realtime = await import("./realtime");
  const bus = await import("./data-bus");
  status.__resetSyncStatusForTests();
  const server = new FakeSupabase();
  return { db, sync, status, realtime, bus, server, sb: server.client() };
}

function meals(...names: string[]): Meal[] {
  return names.map((name, i) => ({ id: i + 1, name, foods: [] }));
}

function mealNames(log: { meals: Meal[] } | null): string[] {
  return (log?.meals ?? []).map((m) => m.name);
}

function supplementRow(id: string, name: string): Row {
  return {
    id,
    user_id: USER_ID,
    name,
    dose_label: "1 capsule",
    micros: {},
    schedule: null,
    notes: null,
    sort_order: null,
    created_at: "2026-05-01T00:00:00.000+00:00",
  };
}

describe("pull and realtime never overwrite a dirty local row", () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  it("keeps an unpushed edit whose base went stale and surfaces it as a conflict", async () => {
    const { db, sync, status, server, sb } = env;
    // This device pulled version T1, then the user added a snack locally.
    const t1 = server.seed("daily_logs", {
      user_id: USER_ID,
      date: DAY,
      meals: meals("eggs"),
    }).updated_at as string;
    await db.applyServerDailyLog(DAY, meals("eggs"), t1);
    await db.saveDailyLog(DAY, meals("eggs", "snack"));
    // Meanwhile the phone saved breakfast: the server moves to T2.
    Object.assign(server.find("daily_logs", { date: DAY }) ?? {}, {
      meals: meals("phone breakfast"),
      updated_at: server.nextTimestamp(),
    });

    const result = await sync.triggerSync(sb, USER_ID);

    expect(mealNames(await db.getDailyLog(DAY))).toEqual(["eggs", "snack"]);
    expect(result?.conflicts).toBe(1);
    expect(status.getSyncStatus()).toEqual({ state: "conflict", count: 1 });
    // Neither side was silently overwritten.
    expect(
      mealNames(server.find("daily_logs", { date: DAY }) as { meals: Meal[] }),
    ).toEqual(["phone breakfast"]);
  });

  it("never replaces a never-synced local row with the server's row for the same key", async () => {
    const { db, sync, server, sb } = env;
    server.seed("daily_logs", {
      user_id: USER_ID,
      date: DAY,
      meals: meals("theirs"),
    });
    await db.saveDailyLog(DAY, meals("mine"));

    await sync.triggerSync(sb, USER_ID);

    expect(mealNames(await db.getDailyLog(DAY))).toEqual(["mine"]);
  });

  it("realtime: a peer's UPDATE does not overwrite a dirty local row", async () => {
    const { db, realtime, server, sb } = env;
    const t1 = server.nextTimestamp();
    await db.applyServerDailyLog(DAY, meals("eggs"), t1);
    await db.saveDailyLog(DAY, meals("eggs", "snack"));
    const handle = realtime.startRealtimeSubscription(sb, USER_ID);

    server.emit("daily_logs", {
      eventType: "UPDATE",
      new: {
        user_id: USER_ID,
        date: DAY,
        meals: meals("phone breakfast"),
        updated_at: server.nextTimestamp(),
      },
      old: {},
    });
    // A second event for another day: IDB runs readwrite transactions on the
    // same store in creation order, so once this one has landed the first
    // handler's transaction has completed too.
    server.emit("daily_logs", {
      eventType: "INSERT",
      new: {
        user_id: USER_ID,
        date: "2026-05-17",
        meals: meals("marker"),
        updated_at: server.nextTimestamp(),
      },
      old: {},
    });
    await vi.waitFor(async () => {
      expect(await db.getDailyLog("2026-05-17")).not.toBeNull();
    });

    expect(mealNames(await db.getDailyLog(DAY))).toEqual(["eggs", "snack"]);
    handle.unsubscribe();
  });

  it("'keep this device's version' pushes the local edit over the newer server row", async () => {
    const { db, sync, status, server, sb } = env;
    const t1 = server.seed("daily_logs", {
      user_id: USER_ID,
      date: DAY,
      meals: meals("eggs"),
    }).updated_at as string;
    await db.applyServerDailyLog(DAY, meals("eggs"), t1);
    await db.saveDailyLog(DAY, meals("eggs", "snack"));
    Object.assign(server.find("daily_logs", { date: DAY }) ?? {}, {
      meals: meals("phone breakfast"),
      updated_at: server.nextTimestamp(),
    });
    await sync.triggerSync(sb, USER_ID);
    expect(status.getSyncStatus().state).toBe("conflict");

    const result = await sync.resolveConflictsKeepingLocal(sb, USER_ID);

    expect(result?.conflicts).toBe(0);
    expect(status.getSyncStatus().state).toBe("synced");
    const serverRow = server.find("daily_logs", { date: DAY }) as {
      meals: Meal[];
      updated_at: string;
    };
    expect(mealNames(serverRow)).toEqual(["eggs", "snack"]);
    const local = await db.getDailyLog(DAY);
    expect(local?.serverUpdatedAt).toBe(serverRow.updated_at);
    expect(local?.localUpdatedAt).toBe(serverRow.updated_at);
  });
});

describe("mark-synced is compare-and-set", () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  it("an edit made while the push is in flight stays dirty and is pushed next sync", async () => {
    const { db, sync, server, sb } = env;
    await db.saveDailyLog(DAY, meals("eggs"));
    server.onWrite = async (table) => {
      if (table !== "daily_logs") return;
      server.onWrite = () => {};
      await db.saveDailyLog(DAY, meals("eggs", "toast"));
    };

    await sync.triggerSync(sb, USER_ID);

    const serverRow = server.find("daily_logs", { date: DAY }) as {
      meals: Meal[];
      updated_at: string;
    };
    expect(mealNames(serverRow)).toEqual(["eggs"]);
    const local = await db.getDailyLog(DAY);
    expect(mealNames(local)).toEqual(["eggs", "toast"]);
    // Took the new base token, but stays dirty.
    expect(local?.serverUpdatedAt).toBe(serverRow.updated_at);
    expect(local?.localUpdatedAt).not.toBe(local?.serverUpdatedAt);

    await sync.triggerSync(sb, USER_ID);
    expect(
      mealNames(server.find("daily_logs", { date: DAY }) as { meals: Meal[] }),
    ).toEqual(["eggs", "toast"]);
  });

  it("the realtime echo of our own push does not revert an edit made mid-push", async () => {
    const { db, sync, server, sb } = env;
    await db.saveDailyLog(DAY, meals("eggs"));
    server.onWrite = async (table) => {
      if (table !== "daily_logs") return;
      server.onWrite = () => {};
      await db.saveDailyLog(DAY, meals("eggs", "toast"));
    };
    await sync.triggerSync(sb, USER_ID);
    const echo = server.find("daily_logs", { date: DAY }) as {
      meals: Meal[];
      updated_at: string;
    };

    // What handleDailyLog does with the echo of our own write.
    expect(await db.applyServerDailyLog(DAY, echo.meals, echo.updated_at)).toBe(
      "kept-dirty",
    );
    expect(mealNames(await db.getDailyLog(DAY))).toEqual(["eggs", "toast"]);
  });

  it("writes made during a sync stay pending after it succeeds", async () => {
    const { db, sync, status, server, sb } = env;
    await db.saveDailyLog(DAY, meals("eggs"));
    status.bumpPending();
    server.onWrite = async () => {
      server.onWrite = () => {};
      await db.saveDailyLog(DAY, meals("eggs", "toast"));
      status.bumpPending();
    };

    await sync.triggerSync(sb, USER_ID);

    expect(status.getSyncSnapshot()).toMatchObject({
      status: { state: "synced" },
      pending: 1,
      pendingSinceAttempt: 1,
    });
  });
});

describe("the echo of our own push is a no-op", () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  it("realtime: the echo after mark-synced neither rewrites the row nor wakes the data bus", async () => {
    const { db, sync, realtime, bus, server, sb } = env;
    await db.saveDailyLog(DAY, meals("eggs"));
    await sync.triggerSync(sb, USER_ID);
    const echo = { ...(server.find("daily_logs", { date: DAY }) ?? {}) };
    const before = await db.getDailyLog(DAY);
    const handle = realtime.startRealtimeSubscription(sb, USER_ID);
    const version = bus.getDataVersion("dailyLogs");

    server.emit("daily_logs", { eventType: "UPDATE", new: echo, old: {} });
    // Same-store marker: once it has landed, the echo's transaction has
    // completed too (IDB runs them in creation order).
    server.emit("daily_logs", {
      eventType: "INSERT",
      new: {
        user_id: USER_ID,
        date: "2026-05-17",
        meals: meals("marker"),
        updated_at: server.nextTimestamp(),
      },
      old: {},
    });
    await vi.waitFor(async () => {
      expect(await db.getDailyLog("2026-05-17")).not.toBeNull();
    });

    // Only the marker notified. A notify for the echo would make
    // useDailyLog reload and replace edits still in its save debounce.
    expect(bus.getDataVersion("dailyLogs")).toBe(version + 1);
    expect(await db.getDailyLog(DAY)).toEqual(before);
    handle.unsubscribe();
  });

  it("a push whose acknowledgement was lost settles on the next pull instead of being re-sent", async () => {
    const { db, sync, status, server, sb } = env;
    await db.saveDailyLog(DAY, meals("eggs"));
    // The server commits the row, but the response never reaches us.
    server.onWrite = () => {
      server.onWrite = () => {};
      throw new Error("network connection lost");
    };
    await expect(sync.triggerSync(sb, USER_ID)).rejects.toThrow(
      /connection lost/,
    );
    const committed = server.find("daily_logs", { date: DAY }) as {
      updated_at: string;
    };
    const writes = server.attempts.length;

    const result = await sync.triggerSync(sb, USER_ID);

    expect(result?.conflicts).toBe(0);
    expect(result?.pushed.dailyLogs).toBe(0);
    expect(
      server.attempts.slice(writes).filter((a) => a.op !== "select"),
    ).toEqual([]);
    expect(status.getSyncStatus().state).toBe("synced");
    const local = await db.getDailyLog(DAY);
    expect(mealNames(local)).toEqual(["eggs"]);
    expect(local?.serverUpdatedAt).toBe(committed.updated_at);
    expect(local?.localUpdatedAt).toBe(committed.updated_at);
  });

  it("a sync right after pushing a row of every table pulls nothing back", async () => {
    const { db, sync, sb } = env;
    await db.saveProfile({
      gender: "male",
      age: 30,
      weight: 70,
      height: 175,
      activityLevel: "moderate",
      goal: "maintain",
      dietType: "balanced",
      dietPreference: "omnivore",
      cuisinePreferences: [],
      allergies: [],
      dislikedFoods: [],
      weeklyRateKg: 0.5,
      manualTdee: null,
      units: "metric",
    });
    await db.saveDailyLog(DAY, meals("eggs"));
    await db.saveWeightEntry(DAY, 80.4);
    await db.setWaterTotal(DAY, 1500);
    await db.saveSupplementIntake(DAY, [{ supplementId: "s", doses: 1 }]);
    await db.saveBodyMeasurement(DAY, { waistCm: 82 });
    await db.saveBloodPressure(DAY, { systolic: 120, diastolic: 80 });
    await db.saveFastSession({
      startedAt: Date.UTC(2026, 4, 15, 20),
      endedAt: Date.UTC(2026, 4, 16, 12),
      protocol: "16:8",
      targetHours: 16,
    });
    await db.addCustomFood({
      name: "Tofu",
      protein: 8,
      carbs: 2,
      fat: 4,
      calories: 76,
    });
    await db.saveMealTemplate({ name: "Breakfast", foods: [] });
    const recipeId = await db.addRecipe({ name: "Chili", ingredients: [] });
    await db.addMealSchedule({
      recipeId,
      recipeName: "Chili",
      mealNames: ["Dinner"],
      startDate: DAY,
      endDate: DAY,
      daysOfWeek: [1],
      scale: 1,
    });
    await db.addSupplement({ name: "Vitamin D", doseLabel: "1", micros: {} });
    await db.addPantryItem({ name: "Milk", quantity: 2, unit: "l" });
    await db.addPantryNotification({
      type: "low-stock",
      itemId: "p",
      itemName: "Milk",
      quantity: 0.5,
      unit: "l",
      read: false,
    });
    await db.upsertFavoriteStore({
      id: "node/1",
      name: "Corner shop",
      kind: "supermarket",
      lat: 0,
      lon: 0,
    });
    await db.addFavoriteFood(
      {
        id: "x",
        source: "custom",
        name: "Oats",
        protein: 13,
        carbs: 60,
        fat: 7,
        calories: 380,
      },
      40,
    );
    const first = await sync.triggerSync(sb, USER_ID);
    const { micronutrientProfiles: _pullOnly, ...pushed } = first?.pushed ?? {};
    void _pullOnly;
    expect(Object.entries(pushed).filter(([, n]) => n !== 1)).toEqual([]);

    const second = await sync.triggerSync(sb, USER_ID);

    expect(
      Object.entries(second?.pulled ?? {}).filter(([, n]) => n !== 0),
    ).toEqual([]);
  });
});

describe("error isolation", () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  it("a server-rejected row doesn't stop the other rows or tables, and the run still fails", async () => {
    const { db, sync, status, server, sb } = env;
    server.fail = (table, op, row) =>
      table === "weight_history" && op === "upsert" && Number(row?.kg) >= 500
        ? {
            code: "23514",
            message:
              'new row for relation "weight_history" violates check constraint "weight_history_kg_check"',
          }
        : null;
    await db.saveWeightEntry("2026-05-01", 805); // typo for 80.5
    await db.saveWeightEntry("2026-05-02", 80.4);
    await db.setWaterTotal(DAY, 1500);

    await expect(sync.triggerSync(sb, USER_ID)).rejects.toThrow(
      /check constraint/,
    );

    expect(server.find("weight_history", { date: "2026-05-02" })).toBeDefined();
    expect(server.find("water_intake", { date: DAY })?.ml).toBe(1500);
    // The rejected row stays dirty for a later retry.
    const bad = (await db.listWeightEntries()).find(
      (e) => e.date === "2026-05-01",
    );
    expect(bad?.serverUpdatedAt).toBeNull();
    expect(status.getSyncStatus().state).toBe("error");
  });

  it("a failed table pull doesn't prevent the other tables from syncing", async () => {
    const { db, sync, server, sb } = env;
    server.fail = (table, op) =>
      table === "daily_logs" && op === "select"
        ? { code: "XX000", message: "upstream timeout" }
        : null;
    await db.addCustomFood({
      name: "Tofu",
      protein: 8,
      carbs: 2,
      fat: 4,
      calories: 76,
    });

    await expect(sync.triggerSync(sb, USER_ID)).rejects.toThrow(
      /upstream timeout/,
    );
    expect(server.rows("custom_foods")).toHaveLength(1);
  });

  it("re-mints a 42501-rejected UUID at most once, then reports the failure", async () => {
    const { db, sync, server, sb } = env;
    let rejected = 0;
    // A cap so a regression to unbounded re-minting fails the assertion
    // below instead of hanging the suite.
    server.fail = (table, op) =>
      table === "custom_foods" && op === "upsert" && rejected++ < 5
        ? { code: "42501", message: "new row violates row-level security" }
        : null;
    const originalId = await db.addCustomFood({
      name: "Tofu",
      protein: 8,
      carbs: 2,
      fat: 4,
      calories: 76,
    });

    await expect(sync.triggerSync(sb, USER_ID)).rejects.toThrow(/42501/);

    expect(
      server.attempts.filter(
        (a) => a.table === "custom_foods" && a.op === "upsert",
      ),
    ).toHaveLength(2);
    const local = await db.listCustomFoods();
    expect(local).toHaveLength(1);
    expect(local[0]?.id).not.toBe(originalId);
    expect(local[0]?.name).toBe("Tofu");
  });
});

describe("remote delete reconciliation", () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  it("removes a clean row that was deleted on the server (no realtime for this table)", async () => {
    const { db, sync, server, sb } = env;
    server.seed("supplements", supplementRow("s-1", "Vitamin D"));
    await sync.triggerSync(sb, USER_ID);
    expect(await db.listSupplements()).toHaveLength(1);

    server.tables.supplements = []; // deleted on the phone

    await sync.triggerSync(sb, USER_ID);
    expect(await db.listSupplements()).toHaveLength(0);
  });

  it("keeps a locally-edited row that was deleted on the server and re-pushes it", async () => {
    const { db, sync, server, sb } = env;
    server.seed("supplements", supplementRow("s-1", "Vitamin D"));
    await sync.triggerSync(sb, USER_ID);
    const [pulled] = await db.listSupplements();
    if (!pulled) throw new Error("expected the pulled supplement");
    await db.upsertSupplement({ ...pulled, name: "Vitamin D3" });
    server.tables.supplements = [];

    const result = await sync.triggerSync(sb, USER_ID);

    expect(result?.conflicts).toBe(0);
    expect(server.find("supplements", { id: "s-1" })?.name).toBe("Vitamin D3");
    const [kept] = await db.listSupplements();
    expect(kept?.name).toBe("Vitamin D3");
    expect(kept?.localUpdatedAt).toBe(kept?.serverUpdatedAt);
  });

  it("does not remove a never-synced local row", async () => {
    const { db, sync, server, sb } = env;
    await db.addSupplement({
      name: "Magnesium",
      doseLabel: "200 mg",
      micros: {},
    });

    await sync.triggerSync(sb, USER_ID);

    expect(await db.listSupplements()).toHaveLength(1);
    expect(server.rows("supplements")).toHaveLength(1);
  });

  it("pages past PostgREST max_rows so a large table is read completely", async () => {
    const { db, sync, server, sb } = env;
    const start = Date.UTC(2023, 0, 1);
    for (let i = 0; i < 1005; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      server.seed("daily_logs", { user_id: USER_ID, date, meals: [] });
    }

    await sync.triggerSync(sb, USER_ID);

    expect(await db.listDailyLogs()).toHaveLength(1005);
  });

  it("does not resurrect a row whose tombstone failed to push", async () => {
    const { db, sync, server, sb } = env;
    server.seed("supplements", supplementRow("s-1", "Vitamin D"));
    await sync.triggerSync(sb, USER_ID);
    await db.deleteSupplement("s-1");
    server.fail = (table, op) =>
      table === "supplements" && op === "delete"
        ? { code: "XX000", message: "network blip" }
        : null;

    await expect(sync.triggerSync(sb, USER_ID)).rejects.toThrow(/network blip/);

    expect(await db.listSupplements()).toHaveLength(0);
    expect(await db.listDeletions()).toHaveLength(1);
  });

  it("realtime: ignores another user's DELETE for the same date", async () => {
    const { db, realtime, server, sb } = env;
    await db.applyServerDailyLog(DAY, meals("eggs"), server.nextTimestamp());
    const handle = realtime.startRealtimeSubscription(sb, USER_ID);

    server.emit("daily_logs", {
      eventType: "DELETE",
      new: {},
      old: { user_id: OTHER_USER_ID, date: DAY },
    });
    server.emit("daily_logs", {
      eventType: "INSERT",
      new: {
        user_id: USER_ID,
        date: "2026-05-17",
        meals: meals("marker"),
        updated_at: server.nextTimestamp(),
      },
      old: {},
    });
    await vi.waitFor(async () => {
      expect(await db.getDailyLog("2026-05-17")).not.toBeNull();
    });

    expect(mealNames(await db.getDailyLog(DAY))).toEqual(["eggs"]);
    handle.unsubscribe();
  });
});

describe("pulls select every column their push writes", () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  function pantryRow(): Row {
    return {
      id: "p-1",
      user_id: USER_ID,
      name: "Milk",
      quantity: 2,
      unit: "l",
      note: null,
      category: "dairy",
      density: 1.03,
      low_threshold: 1,
      created_at: "2026-05-01T00:00:00.000+00:00",
    };
  }

  it("keeps pantry category / density / low_threshold through pull → edit → push", async () => {
    const { db, sync, server, sb } = env;
    server.seed("pantry_items", pantryRow());

    await sync.triggerSync(sb, USER_ID);
    const [item] = await db.listPantryItems();
    expect(item).toMatchObject({
      category: "dairy",
      density: 1.03,
      lowThreshold: 1,
    });

    if (!item) throw new Error("expected the pulled pantry item");
    await db.upsertPantryItem({ ...item, quantity: 1.5 }); // a meal draw-down
    await sync.triggerSync(sb, USER_ID);

    expect(server.find("pantry_items", { id: "p-1" })).toMatchObject({
      quantity: 1.5,
      category: "dairy",
      density: 1.03,
      low_threshold: 1,
    });
  });

  it("heals a clean pantry row an older client stored without those columns", async () => {
    const { db, sync, server, sb } = env;
    const row = server.seed("pantry_items", pantryRow());
    // What the pre-fix pull stored: same version, columns missing.
    await db.applyServerPantryItem(
      {
        id: "p-1",
        name: "Milk",
        quantity: 2,
        unit: "l",
        createdAt: Date.parse("2026-05-01T00:00:00.000Z"),
        updatedAt: Date.parse(row.updated_at as string),
      },
      row.updated_at as string,
    );

    await sync.triggerSync(sb, USER_ID);

    const [item] = await db.listPantryItems();
    expect(item).toMatchObject({
      category: "dairy",
      density: 1.03,
      lowThreshold: 1,
    });
  });

  it("every pushed column of every synced table is in that table's pull select", async () => {
    const { sync } = env;
    const m = await import("./mappers");
    const at = 0;
    const pushed: Record<string, object> = {
      daily_logs: m.dailyLogToRow(USER_ID, {
        date: DAY,
        meals: [],
        updatedAt: at,
      }),
      weight_history: m.weightToRow(USER_ID, {
        date: DAY,
        kg: 80,
        recordedAt: at,
      }),
      water_intake: m.waterToRow(USER_ID, { date: DAY, ml: 1, recordedAt: at }),
      supplement_intake: m.supplementIntakeToRow(USER_ID, {
        date: DAY,
        taken: [],
        recordedAt: at,
      }),
      body_measurements: m.bodyMeasurementToRow(USER_ID, {
        date: DAY,
        recordedAt: at,
      }),
      blood_pressure: m.bloodPressureToRow(USER_ID, {
        date: DAY,
        systolic: 120,
        diastolic: 80,
        recordedAt: at,
      }),
      fast_sessions: m.fastSessionToRow(USER_ID, {
        id: "f",
        startedAt: at,
        endedAt: at,
        protocol: "16:8",
        targetHours: 16,
      }),
      custom_foods: m.customFoodToRow(USER_ID, {
        id: "c",
        name: "x",
        protein: 1,
        carbs: 1,
        fat: 1,
        calories: 1,
        createdAt: at,
      }),
      meal_templates: m.mealTemplateToRow(USER_ID, {
        id: "t",
        name: "x",
        foods: [],
        createdAt: at,
        updatedAt: at,
      }),
      recipes: m.recipeToRow(USER_ID, {
        id: "r",
        name: "x",
        ingredients: [],
        createdAt: at,
        updatedAt: at,
      }),
      meal_schedules: m.mealScheduleToRow(USER_ID, {
        id: "s",
        recipeId: "r",
        recipeName: "x",
        mealNames: [],
        startDate: DAY,
        endDate: DAY,
        daysOfWeek: [],
        scale: 1,
        createdAt: at,
        updatedAt: at,
      }),
      supplements: m.supplementToRow(USER_ID, {
        id: "s",
        name: "x",
        doseLabel: "x",
        micros: {},
        createdAt: at,
        updatedAt: at,
      }),
      pantry_items: m.pantryItemToRow(USER_ID, {
        id: "p",
        name: "x",
        quantity: 1,
        unit: "g",
        createdAt: at,
        updatedAt: at,
      }),
      pantry_notifications: m.pantryNotificationToRow(USER_ID, {
        id: "n",
        type: "low-stock",
        itemId: "p",
        itemName: "x",
        quantity: 1,
        unit: "g",
        read: false,
        createdAt: at,
        updatedAt: at,
      }),
      favorite_stores: m.favoriteStoreToRow(USER_ID, {
        id: "node/1",
        name: "x",
        kind: "supermarket",
        lat: 0,
        lon: 0,
        createdAt: at,
        updatedAt: at,
      }),
      favorite_foods: m.favoriteFoodToRow(USER_ID, {
        id: "f",
        nameKey: "x",
        food: {
          id: "x",
          source: "custom",
          name: "x",
          protein: 1,
          carbs: 1,
          fat: 1,
          calories: 1,
        },
        portion: 100,
        createdAt: at,
      }),
    };

    for (const [table, row] of Object.entries(pushed)) {
      const selected = sync.PULLED_COLUMNS[table];
      expect(selected, table).toBeDefined();
      for (const column of [...Object.keys(row), "updated_at"]) {
        expect(selected, `${table}.${column}`).toContain(column);
      }
    }
  });
});

describe("pull page size vs. PostgREST max_rows", () => {
  it("never exceeds the max_rows configured for the API", async () => {
    const { PULL_PAGE_SIZE } = await import("./index");
    // vitest runs from the repo root (see vitest.config.ts).
    const config = readFileSync(
      path.join(process.cwd(), "supabase", "config.toml"),
      "utf8",
    );
    const maxRows = Number(/^\s*max_rows\s*=\s*(\d+)/m.exec(config)?.[1]);
    expect(maxRows).toBeGreaterThanOrEqual(PULL_PAGE_SIZE);
  });
});

describe("compareServerTimestamps", () => {
  it("orders tokens that differ only below the millisecond", async () => {
    const { compareServerTimestamps } = await import("@/lib/db");
    expect(
      compareServerTimestamps(
        "2026-05-16T12:00:00.123457+00:00",
        "2026-05-16T12:00:00.123456+00:00",
      ),
    ).toBeGreaterThan(0);
    expect(
      compareServerTimestamps(
        "2026-05-16T12:00:00.123+00:00",
        "2026-05-16T12:00:00.123000+00:00",
      ),
    ).toBe(0);
    expect(
      compareServerTimestamps("2026-05-16T12:00:00Z", "2026-05-16T12:00:01Z"),
    ).toBeLessThan(0);
  });
});
