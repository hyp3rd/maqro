/**
 * @vitest-environment jsdom
 */
import * as db from "@/lib/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyDataChanged, subscribeDataChanged } from "./data-bus";
import { startRealtimeSubscription } from "./realtime";

// Mock the IDB layer — applyServerX and deleteX are called by the
// realtime handlers; tests assert on these.
vi.mock("@/lib/db", () => ({
  applyServerProfile: vi.fn(),
  applyServerDailyLog: vi.fn(),
  applyServerWeightEntry: vi.fn(),
  applyServerCustomFood: vi.fn(),
  applyServerMealTemplate: vi.fn(),
  applyServerRecipe: vi.fn(),
  deleteDailyLog: vi.fn(),
  deleteWeightEntry: vi.fn(),
  // Pass A: realtime DELETE handler now uses applyServerDeletion
  // (which removes the IDB row AND clears any pending tombstone so
  // we don't push a redundant server-side DELETE). The old per-store
  // delete helpers are still mocked because some other tests reach
  // for them, but the realtime handler now hits applyServerDeletion.
  applyServerDeletion: vi.fn(),
  deleteCustomFood: vi.fn(),
  deleteMealTemplate: vi.fn(),
  deleteRecipe: vi.fn(),
  // For own-echo detection on profile.
  getProfileRecord: vi.fn().mockResolvedValue(null),
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
    expect(channels).toHaveLength(11);

    handle.unsubscribe();
    expect(getRemoveCalls()).toBe(11);
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

  it("skips own-echo on profile (incoming updated_at matches local serverUpdatedAt)", async () => {
    const sameToken = "2026-05-16T12:00:00Z";
    // Local profile already has this exact server token — incoming
    // event is just our own write echoing back; should no-op.
    vi.mocked(db.getProfileRecord).mockResolvedValue({
      weight: 80,
      // other PersonalInfo fields not relevant to the test
      localUpdatedAt: sameToken,
      serverUpdatedAt: sameToken,
    } as unknown as Awaited<ReturnType<typeof db.getProfileRecord>>);

    const { sb, channels } = makeFakeSupabase();
    startRealtimeSubscription(sb, USER_ID);

    const profileChannel = channels.find((c) => c.table === "profiles");
    if (!profileChannel) throw new Error("missing profile channel");

    profileChannel.onCallback({
      eventType: "UPDATE",
      new: { user_id: USER_ID, payload: { weight: 80 }, updated_at: sameToken },
      old: {},
    });
    await Promise.resolve();
    await Promise.resolve();

    // No write — we recognized the echo.
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
