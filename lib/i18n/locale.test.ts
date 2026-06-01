import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  isLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale";

describe("isLocale", () => {
  it("accepts every supported locale", () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(isLocale(l)).toBe(true);
    }
  });

  it("rejects unknown strings, undefined, null, numbers", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("EN")).toBe(false); // case-sensitive on purpose
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(isLocale("")).toBe(false);
  });
});

describe("resolveLocale", () => {
  it("returns the cookie when it names a supported locale", () => {
    expect(resolveLocale("it", "en-US,en;q=0.9")).toBe("it");
    expect(resolveLocale("en", "it-IT,it;q=0.9")).toBe("en");
  });

  it("ignores a cookie that names an unsupported locale", () => {
    expect(resolveLocale("fr", "it-IT,it;q=0.9")).toBe("it");
  });

  it("falls back to Accept-Language when no cookie is set", () => {
    expect(resolveLocale(undefined, "it-IT,it;q=0.9,en;q=0.8")).toBe("it");
  });

  it("strips regional subtags (it-IT → it)", () => {
    expect(resolveLocale(undefined, "it-CH")).toBe("it");
  });

  it("picks the highest-q supported tag, ignoring higher-q unsupported ones", () => {
    expect(resolveLocale(undefined, "fr;q=1.0,it;q=0.8,en;q=0.5")).toBe("it");
  });

  it("returns the default locale when nothing matches", () => {
    expect(resolveLocale(undefined, "fr-FR,de;q=0.9")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, "")).toBe(DEFAULT_LOCALE);
  });

  it("tolerates malformed q-values without crashing", () => {
    expect(resolveLocale(undefined, "it;q=garbage,en;q=0.5")).toBe("en");
    expect(resolveLocale(undefined, "it;q=5.0,en;q=0.5")).toBe("en"); // q>1 → 0
    expect(resolveLocale(undefined, "it;q=-1,en;q=0.5")).toBe("en"); // q<0 → 0
  });

  it("treats missing q as 1 per the HTTP spec", () => {
    expect(resolveLocale(undefined, "it,en;q=0.5")).toBe("it");
  });

  it("an empty cookie value is the same as no cookie", () => {
    expect(resolveLocale("", "it-IT")).toBe("it");
  });
});
