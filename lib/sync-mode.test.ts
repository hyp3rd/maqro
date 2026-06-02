import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_INTERVAL_MIN,
  MIN_INTERVAL_MIN,
  setAutoSaveInterval,
  setSyncMode,
} from "./sync-mode";

// In-memory localStorage stub — independent of the test environment so
// the device-preference round-trips are deterministic.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync-mode preferences", () => {
  it("persists the chosen mode to localStorage", () => {
    setSyncMode("remote-only");
    expect(localStorage.getItem("maqro:sync-mode")).toBe("remote-only");
    setSyncMode("auto-save");
    expect(localStorage.getItem("maqro:sync-mode")).toBe("auto-save");
    setSyncMode("local-first");
    expect(localStorage.getItem("maqro:sync-mode")).toBe("local-first");
  });

  it("clamps the auto-save interval to the [min, max] range", () => {
    setAutoSaveInterval(0);
    expect(localStorage.getItem("maqro:auto-save-interval")).toBe(
      String(MIN_INTERVAL_MIN),
    );
    setAutoSaveInterval(9999);
    expect(localStorage.getItem("maqro:auto-save-interval")).toBe(
      String(MAX_INTERVAL_MIN),
    );
    setAutoSaveInterval(12);
    expect(localStorage.getItem("maqro:auto-save-interval")).toBe("12");
  });

  it("rounds a fractional interval", () => {
    setAutoSaveInterval(7.6);
    expect(localStorage.getItem("maqro:auto-save-interval")).toBe("8");
  });
});
