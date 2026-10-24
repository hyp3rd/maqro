import { describe, expect, it } from "vitest";
import { formatDayLabel } from "./DateNavigator";

describe("formatDayLabel", () => {
  const TODAY = "2026-06-10";

  it("names today and yesterday", () => {
    expect(formatDayLabel(TODAY, TODAY)).toBe("Today");
    expect(formatDayLabel("2026-06-09", TODAY)).toBe("Yesterday");
  });

  it("dates any other day by its local calendar date", () => {
    expect(formatDayLabel("2026-06-03", TODAY)).toBe(
      new Date(2026, 5, 3).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    );
  });

  it("steps back across a month boundary", () => {
    expect(formatDayLabel("2026-05-31", "2026-06-01")).toBe("Yesterday");
  });
});
