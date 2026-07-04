import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireTurnstile, verifyTurnstile } from "./turnstile";

const { mockReportServerError } = vi.hoisted(() => ({
  mockReportServerError: vi.fn(async () => {}),
}));
vi.mock("@/lib/error-reporter", () => ({
  reportServerError: mockReportServerError,
}));

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function mockFetch(
  impl: (url: unknown, init?: RequestInit) => Promise<Response>,
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  vi.restoreAllMocks();
  mockReportServerError.mockClear();
});

describe("verifyTurnstile — unconfigured", () => {
  it("is a no-op (ok) with no secret and never calls siteverify", async () => {
    const f = mockFetch(async () => new Response());
    expect(await verifyTurnstile("anything", null)).toEqual({ ok: true });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("verifyTurnstile — configured", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "sk_test";
  });

  it("rejects a missing token WITHOUT hitting siteverify (cheap fail-closed)", async () => {
    const f = mockFetch(async () => new Response());
    expect(await verifyTurnstile(undefined, null)).toEqual({
      ok: false,
      reason: "missing-token",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("posts secret+response (+remoteip) and accepts success:true", async () => {
    const f = mockFetch(async (url, init) => {
      expect(String(url)).toBe(SITEVERIFY);
      const body = init?.body as URLSearchParams;
      expect(body.get("secret")).toBe("sk_test");
      expect(body.get("response")).toBe("tok");
      expect(body.get("remoteip")).toBe("1.2.3.4");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    expect(await verifyTurnstile("tok", "1.2.3.4")).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("omits remoteip when the IP is unknown", async () => {
    mockFetch(async (_url, init) => {
      expect((init?.body as URLSearchParams).has("remoteip")).toBe(false);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    expect(await verifyTurnstile("tok", null)).toEqual({ ok: true });
  });

  it("rejects with the error-codes on success:false (e.g. a replayed token)", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["timeout-or-duplicate"],
          }),
          { status: 200 },
        ),
    );
    expect(await verifyTurnstile("replayed", null)).toEqual({
      ok: false,
      reason: "timeout-or-duplicate",
    });
  });

  it("fails closed on a non-200 from siteverify", async () => {
    mockFetch(async () => new Response("nope", { status: 500 }));
    expect((await verifyTurnstile("tok", null)).ok).toBe(false);
  });

  it("fails closed on a network error", async () => {
    mockFetch(async () => {
      throw new Error("siteverify unreachable");
    });
    expect(await verifyTurnstile("tok", null)).toEqual({
      ok: false,
      reason: "network-error",
    });
  });
});

describe("requireTurnstile (route gate)", () => {
  it("is ok when unconfigured (no challenge)", async () => {
    const r = await requireTurnstile(undefined, new Request("http://x/"));
    expect(r.ok).toBe(true);
  });

  it("returns a 403 on a bad token when configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk_test";
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["invalid-input-response"],
          }),
          { status: 200 },
        ),
    );
    const r = await requireTurnstile("bad", new Request("http://x/"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      const body = (await r.response.json()) as { error?: string };
      expect(body.error).toMatch(/human/i);
    }
    // The Cloudflare error-code is logged so the 403 is diagnosable.
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
    const firstCall = mockReportServerError.mock.calls[0] as
      unknown[] | undefined;
    expect(String(firstCall?.[0])).toMatch(/invalid-input-response/);
  });

  it("does NOT log the expected missing-token case (avoids bot-noise flooding)", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sk_test";
    // A script hitting the endpoint without solving the widget is the expected
    // shape of the gate working — it must reject (403) but stay silent.
    const r = await requireTurnstile(
      undefined,
      new Request("http://x/api/auth/recovery"),
    );
    expect(r.ok).toBe(false);
    expect(mockReportServerError).not.toHaveBeenCalled();
  });
});
