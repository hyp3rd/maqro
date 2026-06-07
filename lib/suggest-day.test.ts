import { describe, expect, it } from "vitest";
import { filterDayAssignments } from "./suggest-day";

describe("filterDayAssignments", () => {
  const slots = new Set(["Breakfast", "Lunch", "Dinner"]);
  const ids = new Set(["r1", "r2", "r3"]);

  it("keeps valid (slot, recipe) pairs", () => {
    expect(
      filterDayAssignments(
        [
          { slot: "Breakfast", recipe_id: "r1" },
          { slot: "Dinner", recipe_id: "r3" },
        ],
        slots,
        ids,
      ),
    ).toEqual([
      { slot: "Breakfast", recipeId: "r1" },
      { slot: "Dinner", recipeId: "r3" },
    ]);
  });

  it("drops hallucinated recipe ids", () => {
    expect(
      filterDayAssignments([{ slot: "Lunch", recipe_id: "nope" }], slots, ids),
    ).toEqual([]);
  });

  it("drops unknown slot names", () => {
    expect(
      filterDayAssignments([{ slot: "Brunch", recipe_id: "r1" }], slots, ids),
    ).toEqual([]);
  });

  it("dedupes a repeated slot, keeping the first", () => {
    expect(
      filterDayAssignments(
        [
          { slot: "Dinner", recipe_id: "r1" },
          { slot: "Dinner", recipe_id: "r2" },
        ],
        slots,
        ids,
      ),
    ).toEqual([{ slot: "Dinner", recipeId: "r1" }]);
  });

  it("ignores malformed / non-string entries", () => {
    expect(
      filterDayAssignments(
        [
          { slot: 5, recipe_id: "r1" },
          { recipe_id: "r2" },
          null as unknown as { slot?: unknown },
          {},
        ],
        slots,
        ids,
      ),
    ).toEqual([]);
  });

  it("returns empty for undefined input", () => {
    expect(filterDayAssignments(undefined, slots, ids)).toEqual([]);
  });
});
