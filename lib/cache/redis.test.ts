import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRedisClientForTests,
  cacheGet,
  cacheSetFireAndForget,
} from "./redis";

// Mock the Upstash client as a real (constructable) class so no real connection
// is attempted; `ctorSpy` records construction, `getMock`/`setMock` drive
// behavior. `vi.hoisted` because the `vi.mock` factory runs before module init.
const { getMock, setMock, ctorSpy, afterMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
  ctorSpy: vi.fn(),
  // `after(cb)` runs the callback synchronously here; in a real request it runs
  // after the response is sent. Tests override per-case to simulate out-of-scope.
  afterMock: vi.fn((cb: () => unknown) => cb()),
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = getMock;
    set = setMock;
    constructor() {
      ctorSpy();
    }
  },
}));
vi.mock("next/server", () => ({ after: afterMock }));

describe("lib/cache/redis", () => {
  beforeEach(() => {
    _resetRedisClientForTests();
    ctorSpy.mockClear();
    getMock.mockReset();
    setMock.mockReset();
    afterMock.mockReset();
    afterMock.mockImplementation((cb: () => unknown) => cb());
  });
  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    _resetRedisClientForTests();
  });

  describe("unconfigured (no Upstash env)", () => {
    beforeEach(() => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      _resetRedisClientForTests();
    });

    it("cacheGet returns null and never constructs a client", async () => {
      expect(await cacheGet("k")).toBeNull();
      expect(ctorSpy).not.toHaveBeenCalled();
    });

    it("cacheSetFireAndForget is a no-op (no client, no set)", () => {
      cacheSetFireAndForget("k", { a: 1 }, 60);
      expect(ctorSpy).not.toHaveBeenCalled();
      expect(setMock).not.toHaveBeenCalled();
    });

    it("treats a half-configured pair (url only) as unconfigured", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      _resetRedisClientForTests();
      expect(await cacheGet("k")).toBeNull();
      expect(ctorSpy).not.toHaveBeenCalled();
    });
  });

  describe("configured", () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
      _resetRedisClientForTests();
    });

    it("cacheGet returns the stored value on a hit", async () => {
      getMock.mockResolvedValueOnce({ hello: "world" });
      expect(await cacheGet<{ hello: string }>("k")).toEqual({
        hello: "world",
      });
      expect(getMock).toHaveBeenCalledWith("k");
    });

    it("cacheGet returns null when the key is absent", async () => {
      getMock.mockResolvedValueOnce(null);
      expect(await cacheGet("missing")).toBeNull();
    });

    it("cacheGet swallows a Redis error and returns null (fail-open)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      getMock.mockRejectedValueOnce(new Error("redis down"));
      expect(await cacheGet("k")).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("cacheSetFireAndForget writes with the TTL and returns void (not awaited)", () => {
      setMock.mockResolvedValueOnce("OK");
      const ret = cacheSetFireAndForget("k", { a: 1 }, 90);
      expect(ret).toBeUndefined();
      expect(setMock).toHaveBeenCalledWith("k", { a: 1 }, { ex: 90 });
    });

    it("hands the write to after() so it survives past the response", () => {
      setMock.mockResolvedValueOnce("OK");
      cacheSetFireAndForget("k", { a: 1 }, 30);
      expect(afterMock).toHaveBeenCalledTimes(1);
      expect(setMock).toHaveBeenCalledWith("k", { a: 1 }, { ex: 30 });
    });

    it("falls back to a detached write when after() throws (no request scope)", () => {
      afterMock.mockImplementationOnce(() => {
        throw new Error("after() was called outside a request scope");
      });
      setMock.mockResolvedValueOnce("OK");
      expect(() => cacheSetFireAndForget("k", 2, 30)).not.toThrow();
      expect(setMock).toHaveBeenCalledWith("k", 2, { ex: 30 });
    });

    it("cacheSetFireAndForget never rejects the caller even if the write fails", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      setMock.mockRejectedValueOnce(new Error("write failed"));
      expect(() => cacheSetFireAndForget("k", 1, 60)).not.toThrow();
      // Let the fire-and-forget `.catch` run.
      await Promise.resolve();
      await Promise.resolve();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("memoizes the client across calls", async () => {
      getMock.mockResolvedValue(null);
      await cacheGet("a");
      await cacheGet("b");
      expect(ctorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
