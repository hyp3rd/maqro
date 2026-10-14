import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkAndIncrementAiUsage,
  currentPeriodStart,
  FREE_AI_CAP_PER_MONTH,
  refundAiUsage,
} from "./usage";

const {
  mockGetSupabaseSecretConfig,
  mockCreateClient,
  mockRpc,
  mockSingle,
  mockReportServerError,
} = vi.hoisted(() => {
  const mockSingle = vi.fn();
  // consume_ai_credit is awaited via `.rpc(...).single()`, refund_ai_credit
  // via `.rpc(...)` directly; beforeEach installs the chain as the default.
  const mockRpc = vi.fn<(...args: unknown[]) => unknown>();
  return {
    mockGetSupabaseSecretConfig: vi.fn(
      () =>
        ({ url: "https://x.supabase.co", secretKey: "sb_secret_x" }) as {
          url: string;
          secretKey: string;
        } | null,
    ),
    mockCreateClient: vi.fn(() => ({ rpc: mockRpc })),
    mockRpc,
    mockSingle,
    mockReportServerError: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: mockGetSupabaseSecretConfig,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));

const USER_ID = "user-1";

/** The caller's session client. Serves the RLS-scoped tier reads
 *  (`profiles`, `comp_grants`) and records every table it is asked for,
 *  so a test can prove the counter is never written through it. */
function sessionClient(profile: Record<string, unknown> | null): {
  client: SupabaseClient;
  tables: string[];
} {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const row = table === "profiles" ? profile : null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, tables };
}

const FREE_PROFILE = { is_premium: false, role: "user" };
const PRO_PROFILE = { role: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockReset();
  mockRpc.mockImplementation(() => ({ single: mockSingle }));
  mockSingle.mockReset();
  mockGetSupabaseSecretConfig.mockReturnValue({
    url: "https://x.supabase.co",
    secretKey: "sb_secret_x",
  });
});

describe("currentPeriodStart", () => {
  it("returns the first day of the UTC month in YYYY-MM-DD form", () => {
    expect(currentPeriodStart(new Date("2026-05-17T23:00:00Z"))).toBe(
      "2026-05-01",
    );
    expect(currentPeriodStart(new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-01-01",
    );
    // Right at the month boundary in UTC: month index flips at 00:00 UTC.
    expect(currentPeriodStart(new Date("2026-02-28T23:59:59Z"))).toBe(
      "2026-02-01",
    );
    expect(currentPeriodStart(new Date("2026-03-01T00:00:01Z"))).toBe(
      "2026-03-01",
    );
  });

  it("zero-pads single-digit months", () => {
    expect(currentPeriodStart(new Date("2026-09-15T12:00:00Z"))).toBe(
      "2026-09-01",
    );
  });
});

describe("FREE_AI_CAP_PER_MONTH", () => {
  it("is a positive integer (sanity check — change me deliberately)", () => {
    expect(Number.isInteger(FREE_AI_CAP_PER_MONTH)).toBe(true);
    expect(FREE_AI_CAP_PER_MONTH).toBeGreaterThan(0);
  });
});

describe("checkAndIncrementAiUsage", () => {
  it("debits through the service-role RPC with the tier's cap, never through the session client", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { granted: true, used: 7 },
      error: null,
    });
    const { client, tables } = sessionClient(FREE_PROFILE);

    const res = await checkAndIncrementAiUsage(client, USER_ID);

    expect(res).toEqual({
      allowed: true,
      tier: "free",
      used: 7,
      cap: FREE_AI_CAP_PER_MONTH,
      debitedPeriod: currentPeriodStart(),
    });
    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://x.supabase.co",
      "sb_secret_x",
      expect.anything(),
    );
    expect(mockRpc).toHaveBeenCalledWith("consume_ai_credit", {
      p_user_id: USER_ID,
      p_period_start: currentPeriodStart(),
      p_cap: FREE_AI_CAP_PER_MONTH,
    });
    // The counter is server-owned: the session client only reads the tier.
    expect(tables).not.toContain("ai_usage_monthly");
  });

  it("refuses with cap-reached when the RPC does not grant the credit", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { granted: false, used: FREE_AI_CAP_PER_MONTH },
      error: null,
    });
    const { client } = sessionClient(FREE_PROFILE);

    const res = await checkAndIncrementAiUsage(client, USER_ID);

    expect(res).toEqual({
      allowed: false,
      reason: "cap-reached",
      tier: "free",
      used: FREE_AI_CAP_PER_MONTH,
      cap: FREE_AI_CAP_PER_MONTH,
    });
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it("skips the counter entirely for unmetered tiers", async () => {
    const { client, tables } = sessionClient(PRO_PROFILE);

    const res = await checkAndIncrementAiUsage(client, USER_ID);

    expect(res).toEqual({
      allowed: true,
      tier: "pro",
      used: null,
      cap: null,
      debitedPeriod: null,
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(tables).not.toContain("ai_usage_monthly");
  });

  it("fails closed and reports when the RPC returns an error", async () => {
    const rpcError = Object.assign(new Error("permission denied"), {
      code: "42501",
    });
    mockSingle.mockResolvedValueOnce({ data: null, error: rpcError });
    const { client } = sessionClient(FREE_PROFILE);

    const res = await checkAndIncrementAiUsage(client, USER_ID);

    expect(res).toEqual({ allowed: false, reason: "metering-unavailable" });
    expect(mockReportServerError).toHaveBeenCalledWith(
      rpcError,
      expect.objectContaining({
        context: { step: "consume" },
        userId: USER_ID,
      }),
    );
  });

  it("fails closed and reports when the RPC call throws", async () => {
    mockSingle.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { client } = sessionClient(FREE_PROFILE);

    const res = await checkAndIncrementAiUsage(client, USER_ID);

    expect(res).toEqual({ allowed: false, reason: "metering-unavailable" });
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the RPC payload has an unexpected shape", async () => {
    mockSingle.mockResolvedValueOnce({
      data: [{ granted: true, used: 1 }],
      error: null,
    });
    const { client } = sessionClient(FREE_PROFILE);

    const res = await checkAndIncrementAiUsage(client, USER_ID);

    expect(res).toEqual({ allowed: false, reason: "metering-unavailable" });
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the service-role key is not configured", async () => {
    mockGetSupabaseSecretConfig.mockReturnValue(null);
    const { client } = sessionClient(FREE_PROFILE);

    const res = await checkAndIncrementAiUsage(client, USER_ID);

    expect(res).toEqual({ allowed: false, reason: "metering-unavailable" });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
  });
});

describe("refundAiUsage", () => {
  it("refunds the period that was debited through the service-role RPC", async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });

    await refundAiUsage(USER_ID, "2026-09-01");

    expect(mockRpc).toHaveBeenCalledWith("refund_ai_credit", {
      p_user_id: USER_ID,
      p_period_start: "2026-09-01",
    });
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it("reports a failed refund instead of throwing", async () => {
    const rpcError = new Error("connection reset");
    mockRpc.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(refundAiUsage(USER_ID, "2026-09-01")).resolves.toBe(undefined);
    expect(mockReportServerError).toHaveBeenCalledWith(
      rpcError,
      expect.objectContaining({ context: { step: "refund" } }),
    );
  });
});
