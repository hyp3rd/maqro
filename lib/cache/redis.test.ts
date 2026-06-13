import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRedisClientForTests,
  cacheConfigured,
  cacheDelete,
  cacheGet,
  cacheGetString,
  cacheSetFireAndForget,
  cacheSetIfAbsent,
  cacheSetString,
  pingCache,
} from "./redis";

// Mock the Upstash client as a real (constructable) class so no real connection
// is attempted; `ctorSpy` records construction, `getMock`/`setMock` drive
// behavior. `vi.hoisted` because the `vi.mock` factory runs before module init.
const { getMock, setMock, pingMock, delMock, evalMock, ctorSpy, afterMock } =
  vi.hoisted(() => ({
    getMock: vi.fn(),
    setMock: vi.fn(),
    pingMock: vi.fn(),
    delMock: vi.fn(),
    evalMock: vi.fn(),
    ctorSpy: vi.fn(),
    // `after(cb)` runs the callback synchronously here; in a real request it runs
    // after the response is sent. Tests override per-case to simulate out-of-scope.
    afterMock: vi.fn((cb: () => unknown) => cb()),
  }));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = getMock;
    set = setMock;
    ping = pingMock;
    del = delMock;
    eval = evalMock;
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
    pingMock.mockReset();
    delMock.mockReset();
    evalMock.mockReset();
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

  describe("pingCache (status probe)", () => {
    it("returns skipped when the cache is unconfigured", async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      _resetRedisClientForTests();
      expect(await pingCache()).toBe("skipped");
      expect(ctorSpy).not.toHaveBeenCalled();
    });

    it("returns ok when the ping round-trips", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
      _resetRedisClientForTests();
      pingMock.mockResolvedValueOnce("PONG");
      expect(await pingCache()).toBe("ok");
    });

    it("returns fail when the ping errors", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
      _resetRedisClientForTests();
      pingMock.mockRejectedValueOnce(new Error("redis down"));
      expect(await pingCache()).toBe("fail");
    });
  });

  describe("lock primitives (refresh-lock)", () => {
    describe("unconfigured", () => {
      beforeEach(() => {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        _resetRedisClientForTests();
      });

      it("cacheConfigured is false and never constructs a client", () => {
        expect(cacheConfigured()).toBe(false);
        expect(ctorSpy).not.toHaveBeenCalled();
      });

      it("cacheSetIfAbsent fails open to false (never acquires)", async () => {
        expect(await cacheSetIfAbsent("lock", "nonce", 5000)).toBe(false);
        expect(setMock).not.toHaveBeenCalled();
      });

      it("cacheGetString / cacheSetString / cacheDelete are no-ops", async () => {
        expect(await cacheGetString("k")).toBeNull();
        await cacheSetString("k", "v", 1000);
        await cacheDelete("k");
        expect(setMock).not.toHaveBeenCalled();
        expect(delMock).not.toHaveBeenCalled();
      });
    });

    describe("configured", () => {
      beforeEach(() => {
        process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
        process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
        _resetRedisClientForTests();
      });

      it("cacheConfigured is true", () => {
        expect(cacheConfigured()).toBe(true);
      });

      it("cacheSetIfAbsent uses SET NX PX and returns true only on OK", async () => {
        setMock.mockResolvedValueOnce("OK");
        expect(await cacheSetIfAbsent("lock", "nonce", 5000)).toBe(true);
        expect(setMock).toHaveBeenCalledWith("lock", "nonce", {
          nx: true,
          px: 5000,
        });
      });

      it("cacheSetIfAbsent returns false when the key already exists (null)", async () => {
        setMock.mockResolvedValueOnce(null);
        expect(await cacheSetIfAbsent("lock", "nonce", 5000)).toBe(false);
      });

      it("cacheSetIfAbsent fails open to false on a Redis error", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        setMock.mockRejectedValueOnce(new Error("redis down"));
        expect(await cacheSetIfAbsent("lock", "nonce", 5000)).toBe(false);
        warn.mockRestore();
      });

      it("cacheSetString writes with a px TTL (awaited)", async () => {
        setMock.mockResolvedValueOnce("OK");
        await cacheSetString("k", "payload", 10000);
        expect(setMock).toHaveBeenCalledWith("k", "payload", { px: 10000 });
      });

      it("cacheGetString returns the string on a hit, null on a non-string", async () => {
        getMock.mockResolvedValueOnce("payload");
        expect(await cacheGetString("k")).toBe("payload");
        getMock.mockResolvedValueOnce({ not: "a string" });
        expect(await cacheGetString("k")).toBeNull();
      });

      it("cacheDelete(key) deletes unconditionally", async () => {
        delMock.mockResolvedValueOnce(1);
        await cacheDelete("lock");
        expect(delMock).toHaveBeenCalledWith("lock");
        expect(evalMock).not.toHaveBeenCalled();
      });

      it("cacheDelete(key, expected) compare-and-deletes via an atomic Lua CAS", async () => {
        evalMock.mockResolvedValueOnce(1);
        await cacheDelete("lock", "mine");
        expect(evalMock).toHaveBeenCalledWith(
          expect.stringContaining("redis.call('del'"),
          ["lock"],
          ["mine"],
        );
        // The compare happens server-side atomically — no client GET/DEL gap.
        expect(getMock).not.toHaveBeenCalled();
        expect(delMock).not.toHaveBeenCalled();
      });

      it("cacheDelete(key, expected) tolerates the CAS no-op (value changed → 0)", async () => {
        evalMock.mockResolvedValueOnce(0);
        await expect(cacheDelete("lock", "mine")).resolves.toBeUndefined();
      });

      it("cacheDelete swallows a Redis error (fail-open)", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        delMock.mockRejectedValueOnce(new Error("redis down"));
        await expect(cacheDelete("lock")).resolves.toBeUndefined();
        warn.mockRestore();
      });
    });
  });
});
