import { beforeEach, describe, expect, it, vi } from "vitest";
import { _clearAllowlistCacheForTests, isHostAllowed } from "./host-allowlist";

const { mockSelect, mockFrom } = vi.hoisted(() => {
  const select = vi.fn() as ReturnType<typeof vi.fn>;
  const from = vi.fn(() => ({ select }));
  return { mockSelect: select, mockFrom: from };
});

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseSecretConfig: () => ({
    url: "https://x.supabase.co",
    secretKey: "sb_x",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  _clearAllowlistCacheForTests();
});

describe("isHostAllowed — open mode (empty table)", () => {
  it("allows any hostname when the table is empty", async () => {
    mockSelect.mockResolvedValueOnce({ data: [], error: null });
    const r = await isHostAllowed("any-host.example");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("open");
  });

  it("fails OPEN when the table query errors (Supabase outage)", async () => {
    mockSelect.mockResolvedValueOnce({
      data: null,
      error: { message: "DB down" },
    });
    const r = await isHostAllowed("any-host.example");
    expect(r.ok).toBe(true);
  });
});

describe("isHostAllowed — restrict mode (populated table)", () => {
  beforeEach(() => {
    mockSelect.mockResolvedValue({
      data: [{ hostname: "cooking.nytimes.com" }, { hostname: "example.com" }],
      error: null,
    });
  });

  it("allows an exact match", async () => {
    const r = await isHostAllowed("cooking.nytimes.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("restricted");
  });

  it("allows a subdomain of an entry", async () => {
    const r = await isHostAllowed("recipes.example.com");
    expect(r.ok).toBe(true);
  });

  it("allows a deep subdomain (chained labels)", async () => {
    const r = await isHostAllowed("blog.recipes.example.com");
    expect(r.ok).toBe(true);
  });

  it("rejects a hostname that's not on the list", async () => {
    const r = await isHostAllowed("attacker.test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not on the recipe-import allowlist/i);
  });

  it("rejects a sneaky suffix match (myexample.com vs example.com)", async () => {
    // Critical: an entry of `example.com` MUST NOT match
    // `myexample.com` — that's a suffix-bypass attempt. The matcher
    // walks DNS labels, not raw string suffixes.
    const r = await isHostAllowed("myexample.com");
    expect(r.ok).toBe(false);
  });

  it("matches case-insensitively", async () => {
    const r = await isHostAllowed("Recipes.Example.COM");
    expect(r.ok).toBe(true);
  });
});

describe("isHostAllowed — cache behavior", () => {
  it("hits the DB only once per cache TTL", async () => {
    mockSelect.mockResolvedValue({
      data: [{ hostname: "example.com" }],
      error: null,
    });
    await isHostAllowed("example.com");
    await isHostAllowed("example.com");
    await isHostAllowed("other.example.com");
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after _clearAllowlistCacheForTests", async () => {
    mockSelect.mockResolvedValue({
      data: [{ hostname: "example.com" }],
      error: null,
    });
    await isHostAllowed("example.com");
    _clearAllowlistCacheForTests();
    await isHostAllowed("example.com");
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});
