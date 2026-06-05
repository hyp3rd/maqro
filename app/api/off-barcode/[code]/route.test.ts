import { cacheGet, cacheSetFireAndForget } from "@/lib/cache/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// The route now delegates the fetch + cache to `fetchOffProductResult`. Mock the
// cache so these tests are deterministic regardless of the shell's Upstash env:
// by default `cacheGet` returns undefined ⇒ a miss ⇒ the (mocked) fetch path.
vi.mock("@/lib/cache/redis", () => ({
  cacheGet: vi.fn(),
  cacheSetFireAndForget: vi.fn(),
}));

const originalFetch = globalThis.fetch;

function mockFetch(
  response: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(response), {
        status: init.status ?? (init.ok === false ? 502 : 200),
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

function makeReq(code: string): Request {
  return new Request(`http://localhost/api/off-barcode/${code}`);
}
function makeCtx(code: string) {
  return { params: Promise.resolve({ code }) };
}

describe("GET /api/off-barcode/[code]", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    vi.mocked(cacheGet).mockReset();
    vi.mocked(cacheSetFireAndForget).mockReset();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects non-digit codes with 400", async () => {
    const res = await GET(makeReq("hello"), makeCtx("hello"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid barcode format/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects codes shorter than 8 digits", async () => {
    const res = await GET(makeReq("1234567"), makeCtx("1234567"));
    expect(res.status).toBe(400);
  });

  it("rejects codes longer than 14 digits", async () => {
    const long = "1".repeat(15);
    const res = await GET(makeReq(long), makeCtx(long));
    expect(res.status).toBe(400);
  });

  it("maps a successful OFF product response to a Food object", async () => {
    mockFetch({
      status: 1,
      product: {
        code: "5901234123457",
        product_name: "Some Crisps",
        brands: "Acme",
        nutriments: {
          proteins_100g: 6,
          carbohydrates_100g: 55,
          fat_100g: 30,
          "energy-kcal_100g": 530,
        },
      },
    });

    const res = await GET(makeReq("5901234123457"), makeCtx("5901234123457"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { food: Record<string, unknown> };
    expect(body.food).toMatchObject({
      id: "off:5901234123457",
      source: "off",
      name: "Some Crisps",
      protein: 6,
      carbs: 55,
      fat: 30,
      calories: 530,
      brand: "Acme",
    });
  });

  it("returns 404 when OFF reports status=0 (no product for this barcode)", async () => {
    mockFetch({ status: 0 });
    const res = await GET(makeReq("0000000000000"), makeCtx("0000000000000"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/No product found/);
  });

  it("returns 422 when OFF has the product but no macros (hitToFood drops it)", async () => {
    mockFetch({
      status: 1,
      product: {
        code: "1234567890123",
        product_name: "Mystery Item",
        // No nutriments at all → hitToFood returns null.
      },
    });
    const res = await GET(makeReq("1234567890123"), makeCtx("1234567890123"));
    expect(res.status).toBe(422);
  });

  it("surfaces upstream HTTP errors as 502", async () => {
    mockFetch({ error: "Bad gateway" }, { status: 502 });
    const res = await GET(makeReq("5901234123457"), makeCtx("5901234123457"));
    expect(res.status).toBe(502);
  });

  it("surfaces malformed JSON as 502", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<html>not json</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof fetch;
    const res = await GET(makeReq("5901234123457"), makeCtx("5901234123457"));
    expect(res.status).toBe(502);
  });

  it("returns 504 when the upstream lookup times out", async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            });
          }),
      ) as unknown as typeof fetch;
      const pending = GET(makeReq("5901234123457"), makeCtx("5901234123457"));
      pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(5_000);
      const res = await pending;
      expect(res.status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 404 from a negative-cached barcode (miss envelope) without hitting upstream", async () => {
    vi.mocked(cacheGet).mockResolvedValueOnce({ miss: true });
    const res = await GET(makeReq("0000000000000"), makeCtx("0000000000000"));
    expect(res.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
