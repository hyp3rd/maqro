import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearSettingsCacheForTests,
  getSetting,
  setSetting,
} from "./app-settings";

const { mockMaybeSingle, mockUpsert } = vi.hoisted(() => {
  const maybeSingle = vi.fn() as ReturnType<typeof vi.fn>;
  const upsert = vi.fn() as ReturnType<typeof vi.fn>;
  return { mockMaybeSingle: maybeSingle, mockUpsert: upsert };
});

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "https://x.supabase.co",
    secretKey: "sb_x",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      upsert: mockUpsert,
    }),
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  _clearSettingsCacheForTests();
});

describe("getSetting", () => {
  it("returns the stored value when the row exists", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { value: "ops@example.com" },
      error: null,
    });
    const v = await getSetting("support_inbox", "fallback@x.test");
    expect(v).toBe("ops@example.com");
  });

  it("returns the fallback when the row doesn't exist", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const v = await getSetting("support_inbox", "fallback@x.test");
    expect(v).toBe("fallback@x.test");
  });

  it("returns the fallback on read error (fail-open)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "DB down" },
    });
    const v = await getSetting("support_inbox", "fallback@x.test");
    expect(v).toBe("fallback@x.test");
  });

  it("caches the value across calls within the TTL window", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { value: "first@example.com" },
      error: null,
    });
    await getSetting("support_inbox", "fallback@x.test");
    await getSetting("support_inbox", "fallback@x.test");
    await getSetting("support_inbox", "fallback@x.test");
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it("re-reads after _clearSettingsCacheForTests", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: "x" }, error: null });
    await getSetting("support_inbox", "fallback@x.test");
    _clearSettingsCacheForTests();
    await getSetting("support_inbox", "fallback@x.test");
    expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
  });
});

describe("setSetting", () => {
  it("upserts and reports ok on success", async () => {
    mockUpsert.mockResolvedValueOnce({ error: null });
    const r = await setSetting({
      key: "support_inbox",
      value: "ops@example.com",
      updatedBy: "admin-1",
    });
    expect(r).toEqual({ ok: true });
  });

  it("invalidates the cache so a subsequent read sees the new value", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { value: "old@example.com" },
      error: null,
    });
    await getSetting("support_inbox", "fallback@x.test");
    mockUpsert.mockResolvedValueOnce({ error: null });
    await setSetting({
      key: "support_inbox",
      value: "new@example.com",
      updatedBy: "admin-1",
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { value: "new@example.com" },
      error: null,
    });
    const v = await getSetting("support_inbox", "fallback@x.test");
    expect(v).toBe("new@example.com");
    expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
  });

  it("surfaces the Supabase error on write failure", async () => {
    mockUpsert.mockResolvedValueOnce({
      error: { message: "permission denied" },
    });
    const r = await setSetting({
      key: "support_inbox",
      value: "x@example.com",
      updatedBy: "admin-1",
    });
    expect(r.ok).toBe(false);
  });
});
