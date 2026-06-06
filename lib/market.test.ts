import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMarketOverride,
  getMarket,
  setHomeMarket,
  setMarket,
} from "./market";

// In-memory localStorage stub + a settable navigator.language — independent of
// the test environment so the device-pref round-trips are deterministic
// (mirrors lib/sync-mode.test.ts). `homeMarket` is module-level state, so it's
// reset around every case.
const store = new Map<string, string>();

function setLang(language: string) {
  vi.stubGlobal("navigator", { language });
}

beforeEach(() => {
  store.clear();
  setHomeMarket(undefined);
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
  setLang("en-US");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setHomeMarket(undefined);
});

describe("lib/market", () => {
  describe("resolution precedence: device override → home → browser", () => {
    it("falls back to the browser region when nothing is set (de-DE → DE)", () => {
      setLang("de-DE");
      expect(getMarket()).toBe("DE");
    });

    it("home market overrides the browser region", () => {
      setLang("de-DE");
      setHomeMarket("FR");
      expect(getMarket()).toBe("FR");
    });

    it("device override wins over the home market", () => {
      setLang("de-DE");
      setHomeMarket("FR");
      setMarket("IT");
      expect(getMarket()).toBe("IT");
    });

    it("clearing the override falls back to the home market", () => {
      setHomeMarket("FR");
      setMarket("IT");
      expect(getMarket()).toBe("IT");
      clearMarketOverride();
      expect(getMarket()).toBe("FR");
    });

    it("clearing the override with no home falls back to the browser region", () => {
      setLang("es-ES");
      setMarket("IT");
      clearMarketOverride();
      expect(getMarket()).toBe("ES");
    });
  });

  describe("browser region default", () => {
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

  describe("validation", () => {
    it("ignores an invalid stored override, using the default", () => {
      setLang("it-IT");
      localStorage.setItem("maqro:market", "XX");
      expect(getMarket()).toBe("IT");
    });

    it("ignores an invalid home market, using the browser region", () => {
      setLang("it-IT");
      setHomeMarket("XX");
      expect(getMarket()).toBe("IT");
    });

    it("round-trips world as an override", () => {
      setLang("de-DE");
      setMarket("world");
      expect(getMarket()).toBe("world");
    });
  });
});
