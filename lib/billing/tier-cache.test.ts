/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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

  it("clearCachedTier drops every entry (sign-out)", () => {
    writeCachedTier("u2", "pro");
    clearCachedTier();
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
