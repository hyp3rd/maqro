/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CACHED_USERS,
  TIER_CACHE_MAX_AGE_MS,
  clearCachedTier,
  forgetCachedTier,
  readCachedTier,
  writeCachedTier,
} from "./tier-cache";

const STORAGE_KEY = "maqro:billing:last-known-tier:v1";
const CONFIRMED_AT = Date.UTC(2026, 5, 10, 12);

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CONFIRMED_AT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tier cache: maximum age", () => {
  it("a tier the server confirmed 30 days ago still applies", () => {
    writeCachedTier("u1", "pro");
    vi.setSystemTime(CONFIRMED_AT + TIER_CACHE_MAX_AGE_MS);
    expect(readCachedTier("u1")).toBe("pro");
  });

  it("an older entry is ignored and dropped", () => {
    writeCachedTier("u1", "pro");
    vi.setSystemTime(CONFIRMED_AT + TIER_CACHE_MAX_AGE_MS + 1);
    expect(readCachedTier("u1")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("an entry confirmed 'in the future' (clock moved back) is dropped", () => {
    writeCachedTier("u1", "pro");
    vi.setSystemTime(CONFIRMED_AT - 1);
    expect(readCachedTier("u1")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("an entry without a confirmation time is ignored and dropped", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId: "u1", tier: "pro" }),
    );
    expect(readCachedTier("u1")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("a rewrite restarts the clock", () => {
    writeCachedTier("u1", "pro");
    vi.setSystemTime(CONFIRMED_AT + TIER_CACHE_MAX_AGE_MS);
    writeCachedTier("u1", "pro");
    vi.setSystemTime(CONFIRMED_AT + TIER_CACHE_MAX_AGE_MS * 2);
    expect(readCachedTier("u1")).toBe("pro");
  });
});

describe("tier cache: scope", () => {
  it("is keyed to one user", () => {
    writeCachedTier("u1", "pro");
    expect(readCachedTier("u2")).toBeNull();
    expect(readCachedTier("u1")).toBe("pro");
  });

  it("forgetCachedTier drops only that user's entry", () => {
    writeCachedTier("u2", "pro");
    forgetCachedTier("u1");
    expect(readCachedTier("u2")).toBe("pro");
    forgetCachedTier("u2");
    expect(readCachedTier("u2")).toBeNull();
  });

  it("clearCachedTier drops every entry (device reset)", () => {
    writeCachedTier("u1", "plus");
    writeCachedTier("u2", "pro");
    clearCachedTier();
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("unparseable storage is dropped", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readCachedTier("u1")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("unavailable storage degrades to 'nothing cached'", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    expect(readCachedTier("u1")).toBeNull();
    getItem.mockRestore();
  });
});

describe("tier cache: one entry per user", () => {
  it("A → B → A keeps A's tier", () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "free");
    expect(readCachedTier("u1")).toBe("pro");
    expect(readCachedTier("u2")).toBe("free");
  });

  it("a user's new answer replaces only their own entry", () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "pro");
    writeCachedTier("u1", "free"); // u1 downgraded
    expect(readCachedTier("u1")).toBe("free");
    expect(readCachedTier("u2")).toBe("pro");
  });

  it(`remembers the ${MAX_CACHED_USERS} most recently confirmed users`, () => {
    for (let i = 1; i <= MAX_CACHED_USERS + 1; i++) {
      writeCachedTier(`u${i}`, "pro");
    }
    expect(readCachedTier("u1")).toBeNull(); // the oldest is evicted
    for (let i = 2; i <= MAX_CACHED_USERS + 1; i++) {
      expect(readCachedTier(`u${i}`)).toBe("pro");
    }
  });

  it("a re-confirmed user counts as recent", () => {
    for (let i = 1; i <= MAX_CACHED_USERS; i++) writeCachedTier(`u${i}`, "pro");
    writeCachedTier("u1", "pro");
    writeCachedTier("new", "pro");
    expect(readCachedTier("u1")).toBe("pro");
    expect(readCachedTier("u2")).toBeNull();
  });

  it("each entry keeps its own 30-day maximum age", () => {
    writeCachedTier("u1", "pro");
    vi.setSystemTime(CONFIRMED_AT + 20 * 24 * 60 * 60 * 1000);
    writeCachedTier("u2", "pro");
    vi.setSystemTime(CONFIRMED_AT + TIER_CACHE_MAX_AGE_MS + 1);
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBe("pro");
    // The expired entry is gone from storage, not just ignored.
    vi.setSystemTime(CONFIRMED_AT);
    expect(readCachedTier("u1")).toBeNull();
  });

  it("forgetCachedTier (a 401) keeps the other users' entries", () => {
    writeCachedTier("u1", "pro");
    writeCachedTier("u2", "plus");
    forgetCachedTier("u1");
    expect(readCachedTier("u1")).toBeNull();
    expect(readCachedTier("u2")).toBe("plus");
  });

  it("reads an entry written by an earlier version (a single object)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId: "u1", tier: "pro", confirmedAt: CONFIRMED_AT }),
    );
    expect(readCachedTier("u1")).toBe("pro");
    writeCachedTier("u2", "free");
    expect(readCachedTier("u1")).toBe("pro");
    expect(readCachedTier("u2")).toBe("free");
  });
});
