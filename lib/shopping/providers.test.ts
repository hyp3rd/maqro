import { describe, expect, it } from "vitest";
import { SHOPPING_PROVIDERS, providerSearchUrl } from "./providers";

describe("providerSearchUrl", () => {
  it("builds a search URL per provider", () => {
    expect(providerSearchUrl("ubereats", "brown rice")).toBe(
      "https://www.ubereats.com/search?q=brown%20rice",
    );
    expect(providerSearchUrl("doordash", "brown rice")).toBe(
      "https://www.doordash.com/search/store/brown%20rice",
    );
    expect(providerSearchUrl("glovo", "brown rice")).toBe(
      "https://glovoapp.com/search/?q=brown%20rice",
    );
  });

  it("escapes characters that would break the URL or inject params", () => {
    const url = providerSearchUrl("ubereats", "salt & pepper");
    expect(url).toBe("https://www.ubereats.com/search?q=salt%20%26%20pepper");
    // No raw ampersand → no smuggled query parameter.
    expect(url).not.toContain("& ");
  });

  it("trims and falls back to the Glovo home when query is blank", () => {
    expect(providerSearchUrl("glovo", "   ")).toBe("https://glovoapp.com/");
  });

  it("exposes display metadata for every provider id", () => {
    const ids = SHOPPING_PROVIDERS.map((p) => p.id).sort();
    expect(ids).toEqual(["doordash", "glovo", "ubereats"]);
    for (const p of SHOPPING_PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.accentClass.length).toBeGreaterThan(0);
    }
  });
});
