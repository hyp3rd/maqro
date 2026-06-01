import { describe, expect, it } from "vitest";
import { generateShareSlug, isValidShareSlug, SLUG_LENGTH } from "./share-slug";

describe("generateShareSlug", () => {
  it("returns a slug of the default length", () => {
    const slug = generateShareSlug();
    expect(slug).toHaveLength(SLUG_LENGTH);
  });

  it("respects an explicit length", () => {
    expect(generateShareSlug(6)).toHaveLength(6);
    expect(generateShareSlug(10)).toHaveLength(10);
  });

  it("only uses url-safe alphabet (no ambiguous chars 0/O/1/l/I)", () => {
    // Generate enough samples to catch alphabet leakage.
    for (let i = 0; i < 100; i++) {
      const slug = generateShareSlug();
      expect(slug).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
    }
  });

  it("returns different slugs on each call (high entropy)", () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 1000; i++) slugs.add(generateShareSlug());
    // 7 chars × ~50-char alphabet → 1000 collisions vanishingly rare.
    expect(slugs.size).toBe(1000);
  });

  it("throws on invalid length", () => {
    expect(() => generateShareSlug(0)).toThrow();
    expect(() => generateShareSlug(-1)).toThrow();
    expect(() => generateShareSlug(1.5)).toThrow();
  });
});

describe("isValidShareSlug", () => {
  it("accepts a freshly-generated slug", () => {
    expect(isValidShareSlug(generateShareSlug())).toBe(true);
  });

  it("rejects non-string inputs", () => {
    expect(isValidShareSlug(undefined)).toBe(false);
    expect(isValidShareSlug(null)).toBe(false);
    expect(isValidShareSlug(123)).toBe(false);
    expect(isValidShareSlug({})).toBe(false);
  });

  it("rejects slugs that are too short / too long", () => {
    expect(isValidShareSlug("abc")).toBe(false);
    expect(isValidShareSlug("abcdefghijk")).toBe(false);
  });

  it("rejects slugs containing characters outside the alphabet", () => {
    expect(isValidShareSlug("abc 123")).toBe(false); // space
    expect(isValidShareSlug("0000000")).toBe(false); // 0 not in alphabet
    expect(isValidShareSlug("Olllll1")).toBe(false); // O / l / 1 not in alphabet
    expect(isValidShareSlug("abc/123")).toBe(false); // slash
  });

  it("accepts a manually-specified valid slug", () => {
    expect(isValidShareSlug("abcXYZ7")).toBe(true);
  });
});
