import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_ID_KEY,
  getOrCreateDeviceId,
  inferDeviceLabel,
  parseUserAgent,
  sessionIdFromAccessToken,
} from "./identity";

describe("sessionIdFromAccessToken", () => {
  function makeToken(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return `${header}.${body}.signature`;
  }

  it("returns the session_id claim from a well-formed JWT", () => {
    const token = makeToken({ session_id: "abc-123", sub: "user-1" });
    expect(sessionIdFromAccessToken(token)).toBe("abc-123");
  });

  it("returns null when session_id is missing", () => {
    const token = makeToken({ sub: "user-1" });
    expect(sessionIdFromAccessToken(token)).toBeNull();
  });

  it("returns null on a malformed token", () => {
    expect(sessionIdFromAccessToken("not.a.jwt")).toBeNull();
    expect(sessionIdFromAccessToken("")).toBeNull();
    expect(sessionIdFromAccessToken("only-one-part")).toBeNull();
  });

  it("handles base64url padding correctly", () => {
    const token = makeToken({ session_id: "x" });
    expect(sessionIdFromAccessToken(token)).toBe("x");
  });
});

describe("parseUserAgent", () => {
  it("parses Chrome on macOS with versions", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({
      browser: "Chrome",
      browserVersion: "123",
      os: "macOS",
      osVersion: "10.15",
    });
  });

  it("parses Safari on iOS with versions", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toEqual({
      browser: "Safari",
      browserVersion: "17",
      os: "iOS",
      osVersion: "17.2",
    });
  });

  it("parses Edge on Windows with versions", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(parseUserAgent(ua)).toEqual({
      browser: "Edge",
      browserVersion: "120",
      os: "Windows",
      osVersion: "10.0",
    });
  });

  it("parses Firefox on Linux (no OS version)", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(parseUserAgent(ua)).toEqual({
      browser: "Firefox",
      browserVersion: "121",
      os: "Linux",
      osVersion: null,
    });
  });

  it("parses Chrome on Android — Android matcher wins over Linux substring", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({
      browser: "Chrome",
      browserVersion: "123",
      os: "Android",
      osVersion: "14",
    });
  });

  it("falls back gracefully on an unknown UA", () => {
    expect(parseUserAgent("CustomBot/1.0")).toEqual({
      browser: "Browser",
      browserVersion: null,
      os: "device",
      osVersion: null,
    });
    expect(parseUserAgent("")).toEqual({
      browser: "Browser",
      browserVersion: null,
      os: "device",
      osVersion: null,
    });
  });
});

describe("inferDeviceLabel", () => {
  it("composes browser + version on OS + version", () => {
    const chromeMac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
    expect(inferDeviceLabel(chromeMac)).toBe("Chrome 123 on macOS 10.15");
  });

  it("omits version segments when the UA doesn't include them", () => {
    expect(inferDeviceLabel("CustomBot/1.0")).toBe("Browser on device");
  });
});

describe("getOrCreateDeviceId", () => {
  /** Build a minimal `window` shim with a controllable localStorage.
   *  We only need the localStorage methods the helper touches plus
   *  a `__store` peek for assertions. */
  function makeWindow(
    options: {
      initial?: Record<string, string>;
      throwOn?: "getItem" | "setItem";
    } = {},
  ): { __store: Record<string, string> } {
    const store: Record<string, string> = { ...(options.initial ?? {}) };
    const localStorage = {
      getItem(k: string): string | null {
        if (options.throwOn === "getItem") throw new Error("blocked");
        return Object.hasOwn(store, k) ? (store[k] ?? null) : null;
      },
      setItem(k: string, v: string): void {
        if (options.throwOn === "setItem") throw new Error("quota");
        store[k] = v;
      },
      removeItem(k: string): void {
        delete store[k];
      },
    };
    return { __store: store, localStorage } as unknown as {
      __store: Record<string, string>;
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when window is undefined (SSR / node import)", () => {
    // Vitest default env is node, so window is already undefined —
    // but explicit is better than implicit for a test asserting it.
    expect(typeof window).toBe("undefined");
    expect(getOrCreateDeviceId()).toBeNull();
  });

  it("generates and persists a UUID on first call", () => {
    const win = makeWindow();
    vi.stubGlobal("window", win);
    const id = getOrCreateDeviceId();
    expect(id).not.toBeNull();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(win.__store[DEVICE_ID_KEY]).toBe(id);
  });

  it("returns the stored value on subsequent calls (stable)", () => {
    const win = makeWindow({
      initial: { [DEVICE_ID_KEY]: "11111111-2222-3333-4444-555555555555" },
    });
    vi.stubGlobal("window", win);
    expect(getOrCreateDeviceId()).toBe("11111111-2222-3333-4444-555555555555");
    expect(getOrCreateDeviceId()).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("regenerates when the stored value is malformed", () => {
    // A bad value (hand-edited, version-rotation leftover) shouldn't
    // be sent to the server — regenerate and overwrite.
    const win = makeWindow({ initial: { [DEVICE_ID_KEY]: "not-a-uuid" } });
    vi.stubGlobal("window", win);
    const id = getOrCreateDeviceId();
    expect(id).not.toBeNull();
    expect(id).not.toBe("not-a-uuid");
    expect(win.__store[DEVICE_ID_KEY]).toBe(id);
  });

  it("returns null when localStorage throws (e.g., restricted webview)", () => {
    vi.stubGlobal("window", makeWindow({ throwOn: "getItem" }));
    expect(getOrCreateDeviceId()).toBeNull();
  });

  it("returns null when setItem throws (e.g., quota exceeded)", () => {
    vi.stubGlobal("window", makeWindow({ throwOn: "setItem" }));
    expect(getOrCreateDeviceId()).toBeNull();
  });
});
