/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "./error-reporter";

describe("reportClientError", () => {
  beforeEach(() => {
    // Each test gets a fresh fetch mock so call counts and
    // payload assertions don't leak across cases.
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response),
    ) as unknown as typeof fetch;
    // Wipe sessionStorage so the rotating session token isn't
    // shared between tests — would mask bugs in token creation.
    window.sessionStorage.clear();
    // Clear any kill-switch left by a prior test.
    delete (process.env as Record<string, string | undefined>)
      .NEXT_PUBLIC_ERROR_LOG_DISABLED;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts an error event with the expected payload shape", () => {
    reportClientError(new Error("boom"), {
      route: "/test",
      context: { foo: "bar" },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect(call[0]).toBe("/api/errors");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("boom");
    expect(body.route).toBe("/test");
    expect(body.level).toBe("error");
    expect(body.stack).toMatch(/Error: boom/);
    expect(body.context).toEqual({ foo: "bar" });
    expect(body.app_version).toBeTruthy();
    expect(body.session_token).toMatch(/^[a-z0-9]+$/);
  });

  it("strips identity-bearing keys from context", () => {
    reportClientError("oops", {
      route: "/x",
      context: {
        email: "user@example.com",
        token: "abc123",
        password: "secret",
        user_id: "uid-1",
        safe_field: "kept",
      },
    });
    const body = JSON.parse(
      (
        (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock
          .calls[0][1] as RequestInit
      ).body as string,
    );
    expect(body.context).toEqual({ safe_field: "kept" });
  });

  it("reuses the same session token across calls in one session", () => {
    reportClientError("first");
    reportClientError("second");
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const body1 = JSON.parse((calls[0][1] as RequestInit).body as string);
    const body2 = JSON.parse((calls[1][1] as RequestInit).body as string);
    expect(body1.session_token).toBe(body2.session_token);
  });

  it("honors the NEXT_PUBLIC_ERROR_LOG_DISABLED kill switch", () => {
    process.env.NEXT_PUBLIC_ERROR_LOG_DISABLED = "1";
    reportClientError(new Error("ignored"));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("defaults level to error and accepts warning override", () => {
    reportClientError("a");
    reportClientError("b", { level: "warning" });
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const body1 = JSON.parse((calls[0][1] as RequestInit).body as string);
    const body2 = JSON.parse((calls[1][1] as RequestInit).body as string);
    expect(body1.level).toBe("error");
    expect(body2.level).toBe("warning");
  });

  it("truncates oversize context strings", () => {
    const big = "x".repeat(3000);
    reportClientError("e", { context: { huge: big } });
    const body = JSON.parse(
      (
        (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock
          .calls[0][1] as RequestInit
      ).body as string,
    );
    expect(body.context.huge.length).toBeLessThan(big.length);
    expect(body.context.huge.endsWith("[truncated]")).toBe(true);
  });

  it("doesn't throw when fetch rejects", () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("offline")),
    ) as unknown as typeof fetch;
    expect(() => reportClientError("x")).not.toThrow();
  });
});
