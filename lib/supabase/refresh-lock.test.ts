import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  type SanitizedCookie,
  coalescedGetUser,
  decryptBundle,
  encryptBundle,
  isAuthCookieName,
  peekSession,
  refreshLockKey,
} from "./refresh-lock";

// In-memory stand-in for the Upstash primitives so the coalescing logic is
// tested deterministically (no real Redis, no timing). The set-if-absent is
// synchronous up to its return, which makes the "exactly one winner across N
// concurrent calls" assertion deterministic rather than timing-dependent.
const redis = vi.hoisted(() => {
  const store = new Map<string, string>();
  let configured = true;
  return {
    store,
    setConfigured: (v: boolean) => {
      configured = v;
    },
    reset: () => {
      store.clear();
      configured = true;
    },
    cacheConfigured: vi.fn(() => configured),
    cacheSetIfAbsent: vi.fn(async (key: string, value: string) => {
      if (!configured) return false;
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    cacheSetString: vi.fn(async (key: string, value: string) => {
      if (!configured) return;
      store.set(key, value);
    }),
    cacheGetString: vi.fn(async (key: string) => {
      if (!configured) return null;
      return store.get(key) ?? null;
    }),
    cacheDelete: vi.fn(async (key: string, expected?: string) => {
      if (!configured) return;
      if (expected === undefined || store.get(key) === expected) {
        store.delete(key);
      }
    }),
  };
});

vi.mock("@/lib/cache/redis", () => ({
  cacheConfigured: redis.cacheConfigured,
  cacheSetIfAbsent: redis.cacheSetIfAbsent,
  cacheSetString: redis.cacheSetString,
  cacheGetString: redis.cacheGetString,
  cacheDelete: redis.cacheDelete,
}));

const SECRET = "test-auth-refresh-cache-secret-32chars!!";
const AUTH_COOKIE = "sb-abcdef-auth-token";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Build the auth cookie the way @supabase/ssr writes it: `base64-` + base64url
 *  of the JSON session. */
function authCookie(
  session: object,
  name = AUTH_COOKIE,
): { name: string; value: string } {
  const json = JSON.stringify(session);
  return {
    name,
    value: "base64-" + Buffer.from(json, "utf8").toString("base64url"),
  };
}

const freshResponseCookies = (): SanitizedCookie[] => [
  {
    name: AUTH_COOKIE,
    value: "base64-FRESHTOKEN",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 3600,
  },
];

describe("peekSession", () => {
  it("reads expires_at + refresh_token from a base64- prefixed cookie", () => {
    const c = authCookie({ expires_at: 1234, refresh_token: "rt-abc" });
    expect(peekSession([c])).toEqual({
      expiresAt: 1234,
      refreshToken: "rt-abc",
    });
  });

  it("reads a raw (non-prefixed) JSON cookie value", () => {
    const c = {
      name: AUTH_COOKIE,
      value: JSON.stringify({ expires_at: 99, refresh_token: "rt" }),
    };
    expect(peekSession([c])).toEqual({ expiresAt: 99, refreshToken: "rt" });
  });

  it("reassembles chunked cookies in index order", () => {
    const full = authCookie({
      expires_at: 5,
      refresh_token: "rt-chunked",
    }).value;
    const mid = Math.floor(full.length / 2);
    // Deliberately out of order to prove the sort.
    const chunks = [
      { name: `${AUTH_COOKIE}.1`, value: full.slice(mid) },
      { name: `${AUTH_COOKIE}.0`, value: full.slice(0, mid) },
    ];
    expect(peekSession(chunks)).toEqual({
      expiresAt: 5,
      refreshToken: "rt-chunked",
    });
  });

  it("returns null when there is no auth cookie", () => {
    expect(peekSession([{ name: "other", value: "x" }])).toBeNull();
  });

  it("returns null on garbage / unparseable values (fall open)", () => {
    expect(peekSession([{ name: AUTH_COOKIE, value: "not-json" }])).toBeNull();
    expect(
      peekSession([{ name: AUTH_COOKIE, value: "base64-@@@notbase64@@@" }]),
    ).toBeNull();
  });

  it("returns null for the array session form (unsupported → fall open)", () => {
    const c = authCookie(["access", "rt"] as unknown as object);
    expect(peekSession([c])).toBeNull();
  });

  it("returns null when refresh_token is missing", () => {
    expect(peekSession([authCookie({ expires_at: 1 })])).toBeNull();
  });
});

describe("refreshLockKey", () => {
  it("is deterministic for the same token", () => {
    expect(refreshLockKey("rt")).toBe(refreshLockKey("rt"));
  });

  it("differs for different tokens", () => {
    expect(refreshLockKey("rt-a")).not.toBe(refreshLockKey("rt-b"));
  });

  it("NEVER contains the raw refresh token", () => {
    const token = "super-secret-refresh-token-value";
    const key = refreshLockKey(token);
    expect(key).not.toContain(token);
    expect(key.startsWith("auth:rl:")).toBe(true);
  });
});

describe("isAuthCookieName", () => {
  it("matches the base and chunked auth cookies only", () => {
    expect(isAuthCookieName("sb-ref-auth-token")).toBe(true);
    expect(isAuthCookieName("sb-ref-auth-token.0")).toBe(true);
    expect(isAuthCookieName("sb-ref-auth-token.12")).toBe(true);
    expect(isAuthCookieName("sb-ref-auth-token-code-verifier")).toBe(false);
    expect(isAuthCookieName("session")).toBe(false);
  });
});

describe("encryptBundle / decryptBundle", () => {
  beforeEach(() => {
    process.env.AUTH_REFRESH_CACHE_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.AUTH_REFRESH_CACHE_SECRET;
  });

  it("round-trips a payload", () => {
    const env = encryptBundle("hello world");
    expect(env).not.toBeNull();
    expect(decryptBundle(env!)).toBe("hello world");
  });

  it("returns null when the secret is unset", () => {
    delete process.env.AUTH_REFRESH_CACHE_SECRET;
    expect(encryptBundle("x")).toBeNull();
    expect(decryptBundle("a.b.c")).toBeNull();
  });

  it("returns null on a tampered envelope (auth tag fails)", () => {
    const env = encryptBundle("secret")!;
    const [iv, tag, ct] = env.split(".");
    const tampered = `${iv}.${tag}.${Buffer.from("evil").toString("base64")}`;
    expect(decryptBundle(tampered)).toBeNull();
    void ct;
  });

  it("returns null on a malformed envelope", () => {
    expect(decryptBundle("only-one-part")).toBeNull();
  });
});

describe("coalescedGetUser", () => {
  beforeEach(() => {
    redis.reset();
    redis.cacheConfigured.mockClear();
    redis.cacheSetIfAbsent.mockClear();
    redis.cacheSetString.mockClear();
    redis.cacheGetString.mockClear();
    redis.cacheDelete.mockClear();
    process.env.AUTH_REFRESH_CACHE_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.AUTH_REFRESH_CACHE_SECRET;
  });

  const user = { id: "user-1" } as never;
  const immediateSleep = () => Promise.resolve();

  function makeDeps(
    over: Partial<{
      cookies: { name: string; value: string }[];
      getUser: () => Promise<{ data: { user: User | null } }>;
      responseCookies: SanitizedCookie[];
      plantCookies: (c: SanitizedCookie[]) => void;
    }> = {},
  ) {
    const cookies = over.cookies ?? [
      authCookie({ expires_at: nowSec() + 30, refresh_token: "rt-1" }),
    ];
    return {
      readRequestCookies: () => cookies,
      getUser: over.getUser ?? vi.fn(async () => ({ data: { user } })),
      readResponseAuthCookies: () => over.responseCookies ?? [],
      plantCookies: over.plantCookies ?? vi.fn(),
      sleep: immediateSleep,
    };
  }

  it("falls open to a plain getUser when Redis is unconfigured", async () => {
    redis.setConfigured(false);
    const deps = makeDeps();
    const res = await coalescedGetUser(deps);
    expect(res.data.user).toBe(user);
    expect(deps.getUser).toHaveBeenCalledTimes(1);
    expect(redis.cacheSetIfAbsent).not.toHaveBeenCalled();
  });

  it("falls open when the session is NOT near expiry (no lock)", async () => {
    const deps = makeDeps({
      cookies: [
        authCookie({ expires_at: nowSec() + 3600, refresh_token: "rt" }),
      ],
    });
    await coalescedGetUser(deps);
    expect(deps.getUser).toHaveBeenCalledTimes(1);
    expect(redis.cacheSetIfAbsent).not.toHaveBeenCalled();
  });

  it("falls open when the cookie can't be peeked", async () => {
    const deps = makeDeps({
      cookies: [{ name: AUTH_COOKIE, value: "garbage" }],
    });
    await coalescedGetUser(deps);
    expect(deps.getUser).toHaveBeenCalledTimes(1);
    expect(redis.cacheSetIfAbsent).not.toHaveBeenCalled();
  });

  it("winner refreshes, publishes the encrypted cookies, and releases the lock", async () => {
    const deps = makeDeps({ responseCookies: freshResponseCookies() });
    const res = await coalescedGetUser(deps);
    expect(res.data.user).toBe(user);
    expect(deps.getUser).toHaveBeenCalledTimes(1);

    const lockKey = refreshLockKey("rt-1");
    // Lock released; result published + decrypts back to the fresh cookies.
    expect(redis.store.has(lockKey)).toBe(false);
    const env = redis.store.get(`${lockKey}:r`);
    expect(env).toBeTruthy();
    expect(JSON.parse(decryptBundle(env!)!)).toEqual(freshResponseCookies());
  });

  it("winner does NOT publish on sign-out (null user / cleared cookies)", async () => {
    const cleared: SanitizedCookie[] = [{ name: AUTH_COOKIE, value: "" }];
    const deps = makeDeps({
      getUser: vi.fn(async () => ({ data: { user: null } })),
      responseCookies: cleared,
    });
    await coalescedGetUser(deps);
    const lockKey = refreshLockKey("rt-1");
    expect(redis.store.has(`${lockKey}:r`)).toBe(false); // never cache a clear
    expect(redis.store.has(lockKey)).toBe(false); // lock still released
  });

  it("loser reuses the winner's published cookies instead of refreshing", async () => {
    const lockKey = refreshLockKey("rt-1");
    // Simulate a winner mid-flight: lock held + result already published.
    redis.store.set(lockKey, "winner-nonce");
    redis.store.set(
      `${lockKey}:r`,
      encryptBundle(JSON.stringify(freshResponseCookies()))!,
    );

    const plantCookies = vi.fn();
    const getUser = vi.fn(async () => ({ data: { user } }));
    const deps = makeDeps({ plantCookies, getUser });
    const res = await coalescedGetUser(deps);

    expect(res.data.user).toBe(user);
    expect(plantCookies).toHaveBeenCalledWith(freshResponseCookies());
    expect(getUser).toHaveBeenCalledTimes(1); // the post-plant (no-refresh) call
    // The loser must NOT touch the winner's lock.
    expect(redis.store.get(lockKey)).toBe("winner-nonce");
  });

  it("loser falls open when the winner never publishes (crashed)", async () => {
    redis.store.set(refreshLockKey("rt-1"), "winner-nonce"); // lock, no result
    const plantCookies = vi.fn();
    const deps = makeDeps({ plantCookies });
    await coalescedGetUser(deps);
    expect(plantCookies).not.toHaveBeenCalled();
    expect(deps.getUser).toHaveBeenCalledTimes(1); // fell open
  });

  it("across N concurrent calls EXACTLY ONE acquires the lock (one real refresh)", async () => {
    const cookies = [
      authCookie({ expires_at: nowSec() + 30, refresh_token: "rt-shared" }),
    ];
    const acquired: boolean[] = [];
    redis.cacheSetIfAbsent.mockImplementation(
      async (key: string, value: string) => {
        const got = !redis.store.has(key);
        if (got) redis.store.set(key, value);
        acquired.push(got);
        return got;
      },
    );

    const calls = Array.from({ length: 6 }, () =>
      coalescedGetUser({
        readRequestCookies: () => cookies,
        getUser: vi.fn(async () => ({ data: { user } })),
        readResponseAuthCookies: () => freshResponseCookies(),
        plantCookies: vi.fn(),
        sleep: immediateSleep,
      }),
    );
    await Promise.all(calls);

    expect(acquired.filter(Boolean).length).toBe(1);
  });
});
