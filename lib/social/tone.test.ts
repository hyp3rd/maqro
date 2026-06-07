import { describe, expect, it } from "vitest";
import { lintTone } from "./tone";

describe("lintTone", () => {
  it("strips emoji", () => {
    const r = lintTone("Great update 🎉🚀");
    expect(r.text).toBe("Great update");
    expect(r.warnings).toContain("Removed 2 emoji.");
  });

  it("replaces an em dash with a comma", () => {
    const r = lintTone("Scheduling is here — try it");
    expect(r.text).toBe("Scheduling is here, try it");
    expect(r.warnings).toContain("Replaced em/en dash with a comma.");
  });

  it("removes exclamation marks", () => {
    const r = lintTone("Big news!");
    expect(r.text).toBe("Big news.");
    expect(r.warnings).toContain("Removed exclamation mark(s).");
  });

  it("collapses repeated punctuation, keeping a 3-dot ellipsis", () => {
    expect(lintTone("Wait...... what??").text).toBe("Wait... what?");
  });

  it("flags marketing clichés without rewriting them", () => {
    const r = lintTone("This seamless game-changer will elevate your day");
    expect(r.text).toBe("This seamless game-changer will elevate your day");
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        'Cliché: "seamless".',
        'Cliché: "game-changer".',
        'Cliché: "elevate".',
      ]),
    );
  });

  it("flags a hashtag dump", () => {
    const r = lintTone("New release #app #health #nutrition #fitness #macro");
    expect(r.warnings).toContain("5 hashtags (keep it to a few).");
  });

  it("flags over-length against a platform limit", () => {
    const r = lintTone("a".repeat(300), { maxLength: 280 });
    expect(r.warnings).toContain("300 chars, over the 280 limit.");
  });

  it("leaves clean professional copy untouched", () => {
    const clean =
      "Recipe scheduling is live. Plan a week of meals from your saved recipes.";
    const r = lintTone(clean);
    expect(r.text).toBe(clean);
    expect(r.warnings).toEqual([]);
  });
});
