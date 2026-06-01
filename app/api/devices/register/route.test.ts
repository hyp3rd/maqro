import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/** The route does:
 *
 *    supabase.from("user_devices")
 *      .select("id").eq("user_id", ...).eq("device_id", ...).maybeSingle()
 *
 *    supabase.from("user_devices")
 *      .select("id").eq("user_id", ...).eq("session_id", ...).maybeSingle()
 *
 *    supabase.from("user_devices")
 *      .update(...).eq("id", ...)
 *
 *    supabase.from("user_devices")
 *      .insert(...).select("id").maybeSingle()
 *
 *  The mock builder below records every `.eq` call as a (column,
 *  value) pair and lets each test pre-load what `maybeSingle()` /
 *  the insert path resolves to. */

type EqCall = [string, unknown];

interface MockBuilder {
  eqCalls: EqCall[];
  insertCalls: Record<string, unknown>[];
  updateCalls: Record<string, unknown>[];
  selectMaybeSingleResults: Array<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
  insertResult: {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  updateResult: { error: { message: string } | null };
}

type SupabaseUser = { id: string; email: string } | null;

function makeSupabase(opts: { user?: SupabaseUser } = {}): {
  client: ReturnType<typeof buildClient>;
  b: MockBuilder;
} {
  const b: MockBuilder = {
    eqCalls: [],
    insertCalls: [],
    updateCalls: [],
    selectMaybeSingleResults: [],
    insertResult: { data: { id: "row-new" }, error: null },
    updateResult: { error: null },
  };
  // `??` would mask an explicit `user: null` (used to assert the
  // 401 path) — distinguish "not passed" from "passed as null" by
  // checking key presence.
  const user: SupabaseUser =
    "user" in opts
      ? (opts.user as SupabaseUser)
      : { id: "user-1", email: "u@example.com" };
  return { client: buildClient(b, user), b };
}

function buildClient(b: MockBuilder, user: SupabaseUser) {
  // Each chain step records what it needs into `b` then returns a
  // continuation. Anonymous-arrow callbacks throughout so we never
  // declare unused parameters — the Supabase shape requires
  // `.from(table).select(cols)` etc., but the test only cares about
  // the calls' side effects, not the arguments.
  const selectChain = {
    eq: (col: string, val: unknown) => {
      b.eqCalls.push([col, val]);
      return {
        eq: (col2: string, val2: unknown) => {
          b.eqCalls.push([col2, val2]);
          return {
            maybeSingle: () =>
              Promise.resolve(
                b.selectMaybeSingleResults.shift() ?? {
                  data: null,
                  error: null,
                },
              ),
          };
        },
      };
    },
  };
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    from: () => ({
      select: () => selectChain,
      insert: (row: Record<string, unknown>) => {
        b.insertCalls.push(row);
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve(b.insertResult),
          }),
        };
      },
      update: (patch: Record<string, unknown>) => {
        b.updateCalls.push(patch);
        return { eq: () => Promise.resolve(b.updateResult) };
      },
    }),
  };
}

const { mockGetSupabaseServer } = vi.hoisted(() => ({
  mockGetSupabaseServer: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: mockGetSupabaseServer,
}));

function makeRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/devices/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

const VALID_UUID = "11111111-2222-4333-8444-555555555555";
const ANOTHER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/devices/register — guards", () => {
  it("returns 503 when Supabase isn't configured", async () => {
    mockGetSupabaseServer.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ sessionId: "s" }));
    expect(res.status).toBe(503);
  });

  it("returns 401 when there's no session", async () => {
    const { client } = makeSupabase({ user: null });
    mockGetSupabaseServer.mockResolvedValueOnce(client);
    const res = await POST(makeRequest({ sessionId: "s" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body isn't JSON", async () => {
    const { client } = makeSupabase();
    mockGetSupabaseServer.mockResolvedValueOnce(client);
    const req = new Request("http://localhost/api/devices/register", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when sessionId is missing", async () => {
    const { client } = makeSupabase();
    mockGetSupabaseServer.mockResolvedValueOnce(client);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/devices/register — device_id lookup path", () => {
  it("hits the device_id index first and UPDATEs on hit", async () => {
    const { client, b } = makeSupabase();
    // First select (device_id lookup) returns an existing row.
    b.selectMaybeSingleResults.push({ data: { id: "row-1" }, error: null });
    mockGetSupabaseServer.mockResolvedValueOnce(client);

    const res = await POST(
      makeRequest({
        sessionId: "sess-A",
        deviceId: VALID_UUID,
        userAgent: "Mozilla/5.0",
        deviceLabel: "Chrome on macOS",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(false);

    // device_id was the first lookup — verify the columns checked.
    expect(b.eqCalls.slice(0, 2)).toEqual([
      ["user_id", "user-1"],
      ["device_id", VALID_UUID],
    ]);
    // No fallback to session_id when the device_id lookup hit.
    expect(b.eqCalls.find(([c]) => c === "session_id")).toBeUndefined();

    // UPDATE refreshes both keys.
    expect(b.updateCalls[0]).toMatchObject({
      session_id: "sess-A",
      device_id: VALID_UUID,
    });
  });

  it("falls back to session_id when device_id misses", async () => {
    const { client, b } = makeSupabase();
    // device_id lookup miss, session_id lookup hit.
    b.selectMaybeSingleResults.push({ data: null, error: null });
    b.selectMaybeSingleResults.push({
      data: { id: "row-legacy" },
      error: null,
    });
    mockGetSupabaseServer.mockResolvedValueOnce(client);

    const res = await POST(
      makeRequest({ sessionId: "sess-B", deviceId: VALID_UUID }),
    );
    expect(res.status).toBe(200);

    // The fallback path queried session_id after device_id.
    expect(b.eqCalls).toEqual([
      ["user_id", "user-1"],
      ["device_id", VALID_UUID],
      ["user_id", "user-1"],
      ["session_id", "sess-B"],
    ]);
    // UPDATE backfills device_id on the legacy row.
    expect(b.updateCalls[0]?.device_id).toBe(VALID_UUID);
  });

  it("INSERTs when neither lookup finds a row", async () => {
    const { client, b } = makeSupabase();
    b.selectMaybeSingleResults.push({ data: null, error: null });
    b.selectMaybeSingleResults.push({ data: null, error: null });
    mockGetSupabaseServer.mockResolvedValueOnce(client);

    const res = await POST(
      makeRequest({
        sessionId: "sess-C",
        deviceId: ANOTHER_UUID,
        deviceLabel: "Firefox on Linux",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(true);
    expect(b.insertCalls[0]).toMatchObject({
      user_id: "user-1",
      session_id: "sess-C",
      device_id: ANOTHER_UUID,
      device_label: "Firefox on Linux",
    });
  });

  it("uses session_id only when no device_id is sent (legacy client)", async () => {
    const { client, b } = makeSupabase();
    b.selectMaybeSingleResults.push({
      data: { id: "row-legacy" },
      error: null,
    });
    mockGetSupabaseServer.mockResolvedValueOnce(client);

    const res = await POST(makeRequest({ sessionId: "sess-D" }));
    expect(res.status).toBe(200);

    // Only one select chain ran — the session_id one.
    expect(b.eqCalls).toEqual([
      ["user_id", "user-1"],
      ["session_id", "sess-D"],
    ]);
    // device_id stays null on the UPDATE (no client value to set).
    expect(b.updateCalls[0]?.device_id).toBeNull();
  });

  it("ignores malformed device_id values (not a UUID)", async () => {
    const { client, b } = makeSupabase();
    b.selectMaybeSingleResults.push({ data: null, error: null });
    mockGetSupabaseServer.mockResolvedValueOnce(client);

    await POST(
      makeRequest({
        sessionId: "sess-E",
        deviceId: "not-a-uuid-attacker-payload",
      }),
    );

    // Bad device_id → treated as absent → only the session_id
    // lookup runs, and the INSERT path stores null for device_id.
    expect(b.eqCalls).toEqual([
      ["user_id", "user-1"],
      ["session_id", "sess-E"],
    ]);
    expect(b.insertCalls[0]?.device_id).toBeNull();
  });
});

describe("POST /api/devices/register — IP + geo capture", () => {
  it("reads x-forwarded-for, x-vercel-ip-city/country and writes them on INSERT", async () => {
    const { client, b } = makeSupabase();
    b.selectMaybeSingleResults.push({ data: null, error: null });
    b.selectMaybeSingleResults.push({ data: null, error: null });
    mockGetSupabaseServer.mockResolvedValueOnce(client);

    await POST(
      makeRequest(
        { sessionId: "sess-F", deviceId: VALID_UUID },
        {
          "x-forwarded-for": "203.0.113.7, 10.0.0.1",
          "x-vercel-ip-city": "Berlin",
          "x-vercel-ip-country": "DE",
        },
      ),
    );
    expect(b.insertCalls[0]).toMatchObject({
      ip_address: "203.0.113.7",
      geo_city: "Berlin",
      geo_country: "DE",
    });
  });
});
