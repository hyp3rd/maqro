import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireTurnstile, verifyTurnstile } from "./turnstile";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function mockFetch(
  impl: (url: unknown, init?: RequestInit) => Promise<Response>,
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  vi.restoreAllMocks();
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
  });
});
