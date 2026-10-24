/**
 * @vitest-environment jsdom
 */
import * as db from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyDataChanged, subscribeDataChanged } from "./data-bus";
import { startRealtimeSubscription } from "./realtime";

// Mock the IDB layer — applyServerX and deleteX are called by the
// realtime handlers; tests assert on these.
vi.mock("@/lib/storage-status", () => ({
  reportStorageError: vi.fn(),
  reportStorageOk: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  applyServerProfile: vi.fn().mockResolvedValue("applied"),
  applyServerDailyLog: vi.fn().mockResolvedValue("applied"),
  applyServerWeightEntry: vi.fn().mockResolvedValue("applied"),
  applyServerWaterIntake: vi.fn().mockResolvedValue("applied"),
  applyServerCustomFood: vi.fn().mockResolvedValue("applied"),
  applyServerMealTemplate: vi.fn().mockResolvedValue("applied"),
  applyServerRecipe: vi.fn().mockResolvedValue("applied"),
  applyServerDayOverride: vi.fn().mockResolvedValue("applied"),
  deleteDailyLog: vi.fn(),
  deleteWeightEntry: vi.fn(),
  // Pass A: realtime DELETE handler now uses applyServerDeletion
  // (which removes the IDB row AND clears any pending tombstone so
  // we don't push a redundant server-side DELETE). The old per-store
  // delete helpers are still mocked because some other tests reach
  // for them, but the realtime handler now hits applyServerDeletion.
  applyServerDeletion: vi.fn().mockResolvedValue("deleted"),
  deleteCustomFood: vi.fn(),
  deleteMealTemplate: vi.fn(),
  deleteRecipe: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

/** Build a fake Supabase client that captures channel subscriptions so
 *  tests can later dispatch synthetic Realtime events to them. */
function makeFakeSupabase() {
  // Captured per channel: the table, the .on() callback, and the
  // status-callback passed to .subscribe(). Tests reach in and invoke
  // these directly to simulate server-side events.
  type ChannelCapture = {
    name: string;
    table: string;
    filter: string;
    onCallback: (payload: unknown) => void;
    statusCallback: (status: string) => void;
  };
  const channels: ChannelCapture[] = [];
  let removeCalls = 0;

  const sb = {
    channel: (name: string) => {
      const capture: Partial<ChannelCapture> = { name };
      const channel = {
        on: (
          _event: string,
          opts: { table: string; filter: string },
          cb: (payload: unknown) => void,
        ) => {
          capture.table = opts.table;
          capture.filter = opts.filter;
          capture.onCallback = cb;
          return channel;
        },
        subscribe: (statusCb: (status: string) => void) => {
          capture.statusCallback = statusCb;
          channels.push(capture as ChannelCapture);
          return channel;
        },
        // Used by removeChannel internally.
        unsubscribe: () => {},
      };
      return channel;
    },
    removeChannel: () => {
      removeCalls++;
      return Promise.resolve("ok");
    },
  } as unknown as SupabaseClient;

  return { sb, channels, getRemoveCalls: () => removeCalls };
}

describe("startRealtimeSubscription — channel wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens one channel per synced table, each filtered by user_id", () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const tables = channels.map((c) => c.table).sort();
    expect(tables).toEqual([
      "custom_foods",
      "daily_logs",
      "favorite_foods",
      "favorite_stores",
      "meal_templates",
      "micronutrient_profiles",
      "pantry_items",
      "pantry_notifications",
      "profiles",
      "recipes",
      "supplement_intake",
      "training_day_overrides",
      "water_intake",
      "weight_history",
    ]);

    // Every channel's filter pins to the caller's user_id.
    for (const c of channels) {
      expect(c.filter).toBe(`user_id=eq.${USER_ID}`);
    }
  });

  it("unsubscribe removes every channel", () => {
    const { sb, channels, getRemoveCalls } = makeFakeSupabase();
    const handle = startRealtimeSubscription(sb, USER_ID);
    expect(channels).toHaveLength(14);

    handle.unsubscribe();
    expect(getRemoveCalls()).toBe(14);
  });
});

describe("startRealtimeSubscription — payload dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches an INSERT on custom_foods to applyServerCustomFood + notifies the bus", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const customFoodsChannel = channels.find((c) => c.table === "custom_foods");
    if (!customFoodsChannel) throw new Error("missing custom_foods channel");

    const busCb = vi.fn();
    const unsub = subscribeDataChanged("customFoods", busCb);

    // Simulate a Realtime event from another device.
    customFoodsChannel.onCallback({
      eventType: "INSERT",
      new: {
        id: "abc",
        user_id: USER_ID,
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        brand: null,
        category: null,
        sub_category: null,
        diet_kind: null,
        created_at: "2026-05-16T12:00:00Z",
        updated_at: "2026-05-16T12:00:00Z",
      },
      old: {},
    });
    // The handler is async; let microtasks drain.
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(db.applyServerCustomFood)).toHaveBeenCalledTimes(1);
    const [food, serverUpdatedAt] = vi.mocked(db.applyServerCustomFood).mock
      .calls[0];
    expect((food as { id: string }).id).toBe("abc");
    expect(serverUpdatedAt).toBe("2026-05-16T12:00:00Z");
    expect(busCb).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("dispatches a DELETE on custom_foods to applyServerDeletion + notifies", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const customFoodsChannel = channels.find((c) => c.table === "custom_foods");
    if (!customFoodsChannel) throw new Error("missing custom_foods channel");

    const busCb = vi.fn();
    const unsub = subscribeDataChanged("customFoods", busCb);

    customFoodsChannel.onCallback({
      eventType: "DELETE",
      new: {},
      old: { id: "abc" },
    });
    await Promise.resolve();
    await Promise.resolve();

    // The realtime handler now uses applyServerDeletion (not
    // deleteCustomFood). This is load-bearing: deleteCustomFood
    // creates a tombstone, applyServerDeletion does not. Without
    // this, a peer-device delete would echo back here and we'd push
    // a redundant server-side DELETE.
    expect(vi.mocked(db.applyServerDeletion)).toHaveBeenCalledWith(
      "customFoods",
      "abc",
    );
    expect(vi.mocked(db.deleteCustomFood)).not.toHaveBeenCalled();
    expect(busCb).toHaveBeenCalledTimes(1);

    unsub();
  });

  // favorite_stores ids are shared OSM keys and Realtime applies neither the
  // user_id filter nor RLS to DELETE events, so another user's unfavourite of
  // the same store arrives here with the same `old.id`.
  it("applies a favorite_stores DELETE only when old.user_id is the caller", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);
    const channel = channels.find((c) => c.table === "favorite_stores");
    if (!channel) throw new Error("missing favorite_stores channel");

    const busCb = vi.fn();
    const unsub = subscribeDataChanged("favoriteStores", busCb);

    channel.onCallback({
      eventType: "DELETE",
      new: {},
      old: { user_id: USER_ID, id: "node/123" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(db.applyServerDeletion)).toHaveBeenCalledWith(
      "favoriteStores",
      "node/123",
    );
    expect(busCb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("ignores a favorite_stores DELETE for another user's row with the same OSM key", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);
    const channel = channels.find((c) => c.table === "favorite_stores");
    if (!channel) throw new Error("missing favorite_stores channel");

    const busCb = vi.fn();
    const unsub = subscribeDataChanged("favoriteStores", busCb);

    channel.onCallback({
      eventType: "DELETE",
      new: {},
      old: { user_id: "22222222-2222-4222-8222-222222222222", id: "node/123" },
    });
    channel.onCallback({ eventType: "DELETE", new: {}, old: { id: "way/9" } });
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(db.applyServerDeletion)).not.toHaveBeenCalled();
    expect(busCb).not.toHaveBeenCalled();
    unsub();
  });

  it("routes a failed IDB apply to reportStorageError instead of dropping it", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const customFoodsChannel = channels.find((c) => c.table === "custom_foods");
    if (!customFoodsChannel) throw new Error("missing custom_foods channel");

    // Quota / private-mode eviction: the IDB write rejects. Before the
    // run() wrapper this escaped as an unhandled rejection and the
    // storage-health banner never appeared.
    vi.mocked(db.applyServerCustomFood).mockRejectedValueOnce(
      new Error("QuotaExceededError"),
    );

    customFoodsChannel.onCallback({
      eventType: "INSERT",
      new: {
        id: "abc",
        user_id: USER_ID,
        name: "Tofu",
        protein: 8,
        carbs: 2,
        fat: 4,
        calories: 76,
        brand: null,
        category: null,
        sub_category: null,
        diet_kind: null,
        created_at: "2026-05-16T12:00:00Z",
        updated_at: "2026-05-16T12:00:00Z",
      },
      old: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(reportStorageError)).toHaveBeenCalledTimes(1);
  });

  it("doesn't notify the bus when the apply was a no-op (own echo / dirty local row)", async () => {
    // The IDB layer decides inside one transaction whether the event is
    // newer than a clean local copy; an own echo comes back "not-newer"
    // and a dirty local edit "kept-dirty". Either way nothing was written,
    // so hooks must not re-hydrate.
    vi.mocked(db.applyServerProfile).mockResolvedValueOnce("not-newer");
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const profileChannel = channels.find((c) => c.table === "profiles");
    if (!profileChannel) throw new Error("missing profile channel");
    const busCb = vi.fn();
    const unsub = subscribeDataChanged("profile", busCb);

    profileChannel.onCallback({
      eventType: "UPDATE",
      new: {
        user_id: USER_ID,
        payload: { weight: 80 },
        updated_at: "2026-05-16T12:00:00Z",
      },
      old: {},
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(db.applyServerProfile)).toHaveBeenCalledTimes(1);
    expect(busCb).not.toHaveBeenCalled();
    unsub();
  });

  it("ignores a date-keyed DELETE that belongs to another user (DELETE events can't be filtered)", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);
    const ch = channels.find((c) => c.table === "daily_logs");
    if (!ch) throw new Error("missing daily_logs channel");

    ch.onCallback({
      eventType: "DELETE",
      new: {},
      old: {
        user_id: "22222222-2222-4222-8222-222222222222",
        date: "2026-05-16",
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(db.applyServerDeletion)).not.toHaveBeenCalled();

    ch.onCallback({
      eventType: "DELETE",
      new: {},
      old: { user_id: USER_ID, date: "2026-05-16" },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(db.applyServerDeletion)).toHaveBeenCalledWith(
      "dailyLogs",
      "2026-05-16",
    );
  });

  it("applies a peer's training-day override and its back-to-plan DELETE (owner-checked)", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);
    const ch = channels.find((c) => c.table === "training_day_overrides");
    if (!ch) throw new Error("missing training_day_overrides channel");
    const busCb = vi.fn();
    const unsub = subscribeDataChanged("trainingDayOverrides", busCb);

    ch.onCallback({
      eventType: "INSERT",
      new: {
        user_id: USER_ID,
        date: "2026-10-22",
        day: { type: "rest" },
        recorded_at: "2026-10-22T07:00:00Z",
        updated_at: "2026-10-22T07:00:01Z",
      },
      old: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(db.applyServerDayOverride)).toHaveBeenCalledWith(
      "2026-10-22",
      { type: "rest" },
      "2026-10-22T07:00:01Z",
    );
    expect(busCb).toHaveBeenCalledTimes(1);

    // Another user's back-to-plan for the same date must not touch ours.
    ch.onCallback({
      eventType: "DELETE",
      new: {},
      old: {
        user_id: "22222222-2222-4222-8222-222222222222",
        date: "2026-10-22",
      },
    });
    // Nor may one that doesn't name its owner: the date alone is shared.
    ch.onCallback({
      eventType: "DELETE",
      new: {},
      old: { date: "2026-10-22" },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(db.applyServerDeletion)).not.toHaveBeenCalled();

    ch.onCallback({
      eventType: "DELETE",
      new: {},
      old: { user_id: USER_ID, date: "2026-10-22" },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(db.applyServerDeletion)).toHaveBeenCalledWith(
      "trainingDayOverrides",
      "2026-10-22",
    );
    expect(busCb).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("does not apply a server placeholder profile ({} payload) over the local one", async () => {
    // Migration 0074 creates every profiles row at sign-up with an empty
    // payload; webhook/admin writes to that row emit UPDATE events that
    // still carry it. `{}` means "no profile yet" and must never replace
    // the profile the user is editing locally.
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const profileChannel = channels.find((c) => c.table === "profiles");
    if (!profileChannel) throw new Error("missing profile channel");

    profileChannel.onCallback({
      eventType: "UPDATE",
      new: {
        user_id: USER_ID,
        payload: {},
        updated_at: "2026-05-16T12:00:00Z",
      },
      old: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(db.applyServerProfile)).not.toHaveBeenCalled();
  });

  it("ignores empty {} payload (REPLICA IDENTITY not FULL artifact)", async () => {
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const ch = channels.find((c) => c.table === "recipes");
    if (!ch) throw new Error("missing recipes channel");

    ch.onCallback({ eventType: "UPDATE", new: {}, old: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(db.applyServerRecipe)).not.toHaveBeenCalled();
  });
});

describe("startRealtimeSubscription — reconnect callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires onReconnect after a CLOSED → SUBSCRIBED transition", () => {
    const onReconnect = vi.fn();
    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID, { onReconnect });

    const ch = channels[0];

    // Initial SUBSCRIBED isn't a reconnect.
    ch.statusCallback("SUBSCRIBED");
    expect(onReconnect).not.toHaveBeenCalled();

    // Disconnect, then reconnect — that's a real reconnect.
    ch.statusCallback("CLOSED");
    ch.statusCallback("SUBSCRIBED");
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

// Touch the imported `notifyDataChanged` so vitest doesn't flag the
// import as unused (the bus is the *target* of the realtime handler's
// notify; the test subscribes via `subscribeDataChanged` and the
// realtime code is the one that calls `notifyDataChanged` internally).
void notifyDataChanged;
