import type { FoodItem, Meal } from "@/components/macro/types";
import type { DailyLog, PantryItem, ShoppingListMeta } from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  buildDisplayItems,
  computeShoppingList,
  datesBetween,
  nameKey,
} from "./shopping-list";

function food(name: string, portionSize: number, calories = 100): FoodItem {
  return {
    id: Math.random(),
    name,
    protein: 10,
    carbs: 10,
    fat: 5,
    calories,
    portionSize,
  };
}

function meal(name: string, foods: FoodItem[]): Meal {
  return { id: 1, name, foods };
}

function dayLog(date: string, foods: FoodItem[]): DailyLog {
  return {
    date,
    meals: [meal("Breakfast", foods)],
    updatedAt: Date.now(),
    localUpdatedAt: new Date().toISOString(),
    serverUpdatedAt: null,
  };
}

describe("datesBetween", () => {
  it("returns inclusive range as YYYY-MM-DD", () => {
    expect(datesBetween("2026-05-15", "2026-05-18")).toEqual([
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
    ]);
  });

  it("returns a single date when start equals end", () => {
    expect(datesBetween("2026-05-15", "2026-05-15")).toEqual(["2026-05-15"]);
  });

  it("crosses month boundaries correctly", () => {
    expect(datesBetween("2026-05-30", "2026-06-02")).toEqual([
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    ]);
  });
});

describe("computeShoppingList", () => {
  it("returns an empty list when there are no logs", () => {
    expect(computeShoppingList([], "2026-05-15", "2026-05-18")).toEqual([]);
  });

  it("aggregates one row per unique food across the range", () => {
    const logs = [
      dayLog("2026-05-15", [food("Oats", 50), food("Banana", 120)]),
      dayLog("2026-05-16", [food("Oats", 60)]),
      dayLog("2026-05-17", [food("Chicken Breast", 150)]),
    ];
    const items = computeShoppingList(logs, "2026-05-15", "2026-05-17");
    const byName = new Map(items.map((i) => [i.name, i]));
    expect(byName.get("Oats")?.totalGrams).toBe(110); // 50 + 60
    expect(byName.get("Oats")?.appearances).toBe(2);
    expect(byName.get("Banana")?.totalGrams).toBe(120);
    expect(byName.get("Banana")?.appearances).toBe(1);
    expect(byName.get("Chicken Breast")?.totalGrams).toBe(150);
  });

  it("merges different casings of the same name under the first-seen capitalization", () => {
    const logs = [
      dayLog("2026-05-15", [food("Oats", 50)]),
      dayLog("2026-05-16", [food("oats", 30)]),
      dayLog("2026-05-17", [food("OATS", 20)]),
    ];
    const items = computeShoppingList(logs, "2026-05-15", "2026-05-17");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Oats"); // first-seen wins
    expect(items[0].totalGrams).toBe(100);
    expect(items[0].appearances).toBe(3);
  });

  it("ignores logs outside the date range", () => {
    const logs = [
      dayLog("2026-05-10", [food("Old Food", 999)]),
      dayLog("2026-05-15", [food("In Range", 100)]),
      dayLog("2026-05-20", [food("Future Food", 999)]),
    ];
    const items = computeShoppingList(logs, "2026-05-15", "2026-05-18");
    expect(items.map((i) => i.name)).toEqual(["In Range"]);
  });

  it("sorts by total grams desc, ties broken alphabetically", () => {
    const logs = [
      dayLog("2026-05-15", [
        food("Banana", 50),
        food("Apple", 50),
        food("Oats", 200),
      ]),
    ];
    const items = computeShoppingList(logs, "2026-05-15", "2026-05-15");
    expect(items.map((i) => i.name)).toEqual(["Oats", "Apple", "Banana"]);
  });

  it("rounds total grams + calories to the nearest integer", () => {
    const logs = [
      dayLog("2026-05-15", [food("Oats", 50.6, 150.3)]),
      dayLog("2026-05-16", [food("Oats", 50.4, 150.7)]),
    ];
    const items = computeShoppingList(logs, "2026-05-15", "2026-05-16");
    expect(items[0].totalGrams).toBe(101); // 50.6 + 50.4 = 101
    expect(items[0].totalCalories).toBe(301); // 150.3 + 150.7
  });

  it("skips foods with empty / whitespace-only names", () => {
    const logs = [
      dayLog("2026-05-15", [
        food("", 100),
        food("   ", 100),
        food("Valid Food", 50),
      ]),
    ];
    const items = computeShoppingList(logs, "2026-05-15", "2026-05-15");
    expect(items.map((i) => i.name)).toEqual(["Valid Food"]);
  });
});

function meta(
  rows: Array<[string, Partial<ShoppingListMeta>]>,
): Map<string, ShoppingListMeta> {
  const m = new Map<string, ShoppingListMeta>();
  for (const [name, patch] of rows) {
    const key = nameKey(name);
    m.set(key, { name: key, updatedAt: 0, ...patch });
  }
  return m;
}

function pantryMap(
  rows: Array<Partial<PantryItem> & { name: string }>,
): Map<string, PantryItem> {
  const m = new Map<string, PantryItem>();
  for (const r of rows) {
    m.set(nameKey(r.name), {
      id: r.id ?? r.name,
      quantity: r.quantity ?? 0,
      unit: r.unit ?? "g",
      createdAt: 0,
      updatedAt: 0,
      ...r,
    });
  }
  return m;
}

const baseItem = (name: string, totalGrams = 100, appearances = 1) => ({
  name,
  totalGrams,
  appearances,
  totalCalories: 0,
});

describe("buildDisplayItems", () => {
  it("returns computed items unchanged when meta is empty", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200), baseItem("Olive Oil", 50)],
      new Map(),
      new Map(),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.totalGrams).toBe(200);
    expect(out.every((it) => !it.isExtra)).toBe(true);
  });

  it("filters out excluded computed items", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs"), baseItem("Olive Oil")],
      meta([["Olive Oil", { excluded: true }]]),
      new Map(),
    );
    expect(out.map((it) => it.name)).toEqual(["Eggs"]);
  });

  it("applies qtyOverride to a computed item", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200)],
      meta([["Eggs", { qtyOverride: 500 }]]),
      new Map(),
    );
    expect(out[0]?.totalGrams).toBe(500);
  });

  it("ignores a non-positive qtyOverride and falls back to totalGrams", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200)],
      meta([["Eggs", { qtyOverride: 0 }]]),
      new Map(),
    );
    expect(out[0]?.totalGrams).toBe(200);
  });

  it("applies appearancesOverride to a computed item", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200, 2)],
      meta([["Eggs", { appearancesOverride: 5 }]]),
      new Map(),
    );
    expect(out[0]?.appearances).toBe(5);
    expect(out[0]?.totalGrams).toBe(200);
  });

  it("ignores a non-positive appearancesOverride and falls back to derived appearances", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200, 3)],
      meta([["Eggs", { appearancesOverride: 0 }]]),
      new Map(),
    );
    expect(out[0]?.appearances).toBe(3);
  });

  it("applies qtyOverride and appearancesOverride together on the same row", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200, 2)],
      meta([["Eggs", { qtyOverride: 500, appearancesOverride: 4 }]]),
      new Map(),
    );
    expect(out[0]?.totalGrams).toBe(500);
    expect(out[0]?.appearances).toBe(4);
  });

  it("appends extras for meta rows with extraQty that aren't already computed", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs")],
      meta([["Tomatoes", { extraQty: 5, extraUnit: "cans" }]]),
      pantryMap([{ name: "Tomatoes", unit: "cans" }]),
    );
    expect(out).toHaveLength(2);
    const extra = out.find((it) => it.name === "Tomatoes");
    expect(extra?.isExtra).toBe(true);
    expect(extra?.totalGrams).toBe(5);
    expect(extra?.extraUnit).toBe("cans");
  });

  it("does NOT inject an extra when the same name already appears in the computed list", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200)],
      meta([["Eggs", { extraQty: 6, extraUnit: "eggs" }]]),
      new Map(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.isExtra).toBeUndefined();
    expect(out[0]?.totalGrams).toBe(200);
  });

  it("does NOT inject an extra when the meta is excluded", () => {
    // The launch-blocker regression: previously the extras loop only
    // checked extraQty, so deleting a row from the shopping list and
    // then sending the same item from the pantry would resurrect it
    // via the extras branch. Now `excluded: true` wins.
    const out = buildDisplayItems(
      [],
      meta([["Olive Oil", { extraQty: 100, extraUnit: "ml", excluded: true }]]),
      new Map(),
    );
    expect(out).toEqual([]);
  });

  it("uses the pantry item's original casing for an extra's display name", () => {
    const out = buildDisplayItems(
      [],
      meta([["olive oil", { extraQty: 100, extraUnit: "ml" }]]),
      pantryMap([{ name: "Olive Oil", unit: "ml" }]),
    );
    expect(out[0]?.name).toBe("Olive Oil");
  });

  it("title-cases the meta key when no pantry item matches (orphan extra)", () => {
    const out = buildDisplayItems(
      [],
      meta([["chicken breast", { extraQty: 1 }]]),
      new Map(),
    );
    expect(out[0]?.name).toBe("Chicken Breast");
  });

  it("preserves computed-first ordering, extras appended", () => {
    const out = buildDisplayItems(
      [baseItem("Eggs", 200), baseItem("Bread", 100)],
      meta([["Milk", { extraQty: 1, extraUnit: "L" }]]),
      pantryMap([{ name: "Milk", unit: "L" }]),
    );
    expect(out.map((it) => it.name)).toEqual(["Eggs", "Bread", "Milk"]);
  });
});
