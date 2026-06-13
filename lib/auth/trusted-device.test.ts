import { DEVICE_ID_COOKIE } from "@/lib/devices/identity";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findTrustedDeviceRowId,
  isCurrentDeviceTrusted,
  type CookieSource,
} from "./trusted-device";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

function cookieSource(map: Record<string, string>): CookieSource {
  return {
    get(name) {
      const value = map[name];
      return value ? { value } : undefined;
    },
  };
}

function fakeSupabase(opts: {
  row?: { id: string } | null;
  error?: { message: string } | null;
  throws?: boolean;
}): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>;
  fromSpy: ReturnType<typeof vi.fn>;
  filterCalls: Array<{ method: string; args: unknown[] }>;
} {
  const filterCalls: Array<{ method: string; args: unknown[] }> = [];
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((...args: unknown[]) => {
      filterCalls.push({ method: "eq", args });
      return builder;
    }),
    gt: vi.fn((...args: unknown[]) => {
      filterCalls.push({ method: "gt", args });
      return builder;
    }),
    maybeSingle: vi.fn(async () => {
      if (opts.throws) throw new Error("kaboom");
      return { data: opts.row ?? null, error: opts.error ?? null };
    }),
  };
  const fromSpy = vi.fn(() => builder);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { from: fromSpy } as unknown as SupabaseClient<any, any, any>;
  return { client, fromSpy, filterCalls };
}

describe("isCurrentDeviceTrusted", () => {
  it("returns false when the cookie is missing entirely", async () => {
    const { client, fromSpy } = fakeSupabase({});
    const trusted = await isCurrentDeviceTrusted(
      client,
      "user-1",
      cookieSource({}),
    );
    expect(trusted).toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns false when the cookie value isn't a UUID", async () => {
    const { client, fromSpy } = fakeSupabase({});
    const trusted = await isCurrentDeviceTrusted(
      client,
      "user-1",
      cookieSource({ [DEVICE_ID_COOKIE]: "not-a-uuid" }),
    );
    expect(trusted).toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns true on a valid UUID + matching DB row", async () => {
    const { client, fromSpy, filterCalls } = fakeSupabase({
      row: { id: "row-1" },
    });
    const trusted = await isCurrentDeviceTrusted(
      client,
      "user-42",
      cookieSource({ [DEVICE_ID_COOKIE]: VALID_UUID }),
    );
    expect(trusted).toBe(true);
    expect(fromSpy).toHaveBeenCalledWith("mfa_trusted_devices");
    // Filter on user_id, device_id, AND trusted_until > now —
    // missing any of these would let an expired or wrong-user row
    // grant trust.
    expect(
      filterCalls.some(
        (c) =>
          c.method === "eq" &&
          c.args[0] === "user_id" &&
          c.args[1] === "user-42",
      ),
    ).toBe(true);
    expect(
      filterCalls.some(
        (c) =>
          c.method === "eq" &&
          c.args[0] === "device_id" &&
          c.args[1] === VALID_UUID,
      ),
    ).toBe(true);
    expect(
      filterCalls.some(
        (c) => c.method === "gt" && c.args[0] === "trusted_until",
      ),
    ).toBe(true);
  });

  it("returns false when no matching row exists", async () => {
    const { client } = fakeSupabase({ row: null });
    const trusted = await isCurrentDeviceTrusted(
      client,
      "user-1",
      cookieSource({ [DEVICE_ID_COOKIE]: VALID_UUID }),
    );
    expect(trusted).toBe(false);
  });

  it("returns false on a DB error (default-deny)", async () => {
    const { client } = fakeSupabase({
      row: null,
      error: { message: "RLS denial" },
    });
    const trusted = await isCurrentDeviceTrusted(
      client,
      "user-1",
      cookieSource({ [DEVICE_ID_COOKIE]: VALID_UUID }),
    );
    expect(trusted).toBe(false);
  });

  it("returns false when the query throws (no swallowed crash)", async () => {
    const { client } = fakeSupabase({ throws: true });
    const trusted = await isCurrentDeviceTrusted(
      client,
      "user-1",
      cookieSource({ [DEVICE_ID_COOKIE]: VALID_UUID }),
    );
    expect(trusted).toBe(false);
  });
});

describe("findTrustedDeviceRowId", () => {
  it("returns the row id of an unexpired grant (for the /check last_used bump)", async () => {
    const { client, fromSpy } = fakeSupabase({ row: { id: "row-9" } });
    expect(await findTrustedDeviceRowId(client, "user-1", VALID_UUID)).toBe(
      "row-9",
    );
    expect(fromSpy).toHaveBeenCalledWith("mfa_trusted_devices");
  });

  it("returns null when no row matches", async () => {
    const { client } = fakeSupabase({ row: null });
    expect(
      await findTrustedDeviceRowId(client, "user-1", VALID_UUID),
    ).toBeNull();
  });

  it("returns null on a DB error and on a thrown query (default-deny)", async () => {
    const errored = fakeSupabase({ row: null, error: { message: "RLS" } });
    expect(
      await findTrustedDeviceRowId(errored.client, "user-1", VALID_UUID),
    ).toBeNull();
    const thrown = fakeSupabase({ throws: true });
    expect(
      await findTrustedDeviceRowId(thrown.client, "user-1", VALID_UUID),
    ).toBeNull();
  });
});
