import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  CHANGELOG_SEEN_STORAGE_KEY,
  LATEST_CHANGELOG_ID,
} from "./changelog";

/** Invariants the in-app indicator depends on. If any of these
 *  drift, the "what's new" dot stops working correctly - silent
 *  failure since the UI just shows "no new entries" forever. */
describe("changelog data", () => {
  it("has at least one entry", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it("LATEST_CHANGELOG_ID matches the first entry's id", () => {
    expect(LATEST_CHANGELOG_ID).toBe(CHANGELOG[0]?.id);
  });

  it("ids are unique (so localStorage seen-key resolves to one entry)", () => {
    const ids = CHANGELOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dates are valid ISO YYYY-MM-DD strings", () => {
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = new Date(entry.date);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    }
  });

  it("is ordered newest first (descending date)", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      const prev = CHANGELOG[i - 1]?.date ?? "";
      const cur = CHANGELOG[i]?.date ?? "";
      expect(prev >= cur).toBe(true);
    }
  });

  it("uses the namespaced storage key (avoids collisions with other apps)", () => {
    expect(CHANGELOG_SEEN_STORAGE_KEY.startsWith("maqro:")).toBe(true);
  });

  it("every entry has a title and a non-empty body", () => {
    for (const entry of CHANGELOG) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.trim().length).toBeGreaterThan(0);
    }
  });
});
