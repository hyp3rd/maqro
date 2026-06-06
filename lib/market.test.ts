import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMarket, setMarket } from "./market";

// In-memory localStorage stub + a settable navigator.language — independent of
// the test environment so the device-pref round-trips are deterministic
// (mirrors lib/sync-mode.test.ts).
const store = new Map<string, string>();

function setLang(language: string) {
  vi.stubGlobal("navigator", { language });
}

beforeEach(() => {
  store.clear();
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
  setLang("en-US"); // default; overridden per case
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/market", () => {
  describe("default from the browser's explicit region", () => {
    it("uses the explicit region (de-DE → DE)", () => {
      setLang("de-DE");
      expect(getMarket()).toBe("DE");
    });

    it("maps en-GB → GB", () => {
      setLang("en-GB");
      expect(getMarket()).toBe("GB");
    });

    it("falls back to world for a bare language (no region)", () => {
      setLang("en");
      expect(getMarket()).toBe("world");
    });

    it("falls back to world for an unsupported region (en-AU)", () => {
      setLang("en-AU");
      expect(getMarket()).toBe("world");
    });
  });

  describe("stored preference wins over the default", () => {
    it("returns the stored market", () => {
      setLang("de-DE");
      setMarket("FR");
      expect(getMarket()).toBe("FR");
    });

    it("ignores an invalid stored value, using the region default", () => {
      setLang("it-IT");
      localStorage.setItem("maqro:market", "XX");
      expect(getMarket()).toBe("IT");
    });

    it("round-trips world", () => {
      setLang("de-DE");
      setMarket("world");
      expect(getMarket()).toBe("world");
    });
  });
});
