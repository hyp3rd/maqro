import { afterEach, describe, expect, it, vi } from "vitest";
import { clientFetch } from "./client-fetch";
import {
  forceCloseMfaChallenge,
  subscribeMfaChallenge,
} from "./mfa-challenge-bus";

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

afterEach(() => {
  forceCloseMfaChallenge();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("clientFetch", () => {
  it("returns non-MFA responses unchanged", async () => {
    const ok = jsonResponse({ ok: true });
    const fetchMock = vi.fn().mockResolvedValue(ok);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await clientFetch("/api/foo");
    expect(res).toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes non-401/403 errors straight through without retrying", async () => {
    const fail = jsonResponse({ error: "boom" }, { status: 500 });
    const fetchMock = vi.fn().mockResolvedValue(fail);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await clientFetch("/api/foo");
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores 403s that lack the mfa-required kind", async () => {
    const denied = jsonResponse({ error: "forbidden" }, { status: 403 });
    const fetchMock = vi.fn().mockResolvedValue(denied);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await clientFetch("/api/foo");
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prompts for MFA and retries on success", async () => {
    const denied = jsonResponse(
      { error: "mfa required", kind: "mfa-required" },
      { status: 403 },
    );
    const ok = jsonResponse({ ok: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(denied)
      .mockResolvedValueOnce(ok);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const unsubscribe = subscribeMfaChallenge((resolver) => {
      resolver.resolve();
    });

    const res = await clientFetch("/api/foo", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res).toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const replayInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(replayInit.body).toBe(JSON.stringify({ hello: "world" }));
    expect(replayInit.method).toBe("POST");

    unsubscribe();
  });

  it("returns the original 403 when the user cancels the MFA prompt", async () => {
    const denied = jsonResponse(
      { error: "mfa required", kind: "mfa-required" },
      { status: 403 },
    );
    const fetchMock = vi.fn().mockResolvedValue(denied);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const unsubscribe = subscribeMfaChallenge((resolver) => {
      resolver.reject("cancelled");
    });

    const res = await clientFetch("/api/foo");
    expect(res).toBe(denied);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("returns the original 403 when no MFA dialog is mounted", async () => {
    const denied = jsonResponse(
      { error: "mfa required", kind: "mfa-required" },
      { status: 403 },
    );
    const fetchMock = vi.fn().mockResolvedValue(denied);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await clientFetch("/api/foo");
    expect(res).toBe(denied);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
