/**
 * @vitest-environment jsdom
 */
import type { FoodItem, Meal } from "@/components/macro/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueMicronutrientEnrichment } from "./enqueue";

function food(name: string): FoodItem {
  return {
    id: Math.floor(Math.random() * 1e6),
    name,
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 0,
    portionSize: 100,
  };
}

function meal(foods: FoodItem[]): Meal {
  return { id: 1, name: "Meal", foods };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify({ enqueued: 0 }), { status: 200 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("enqueueMicronutrientEnrichment", () => {
  it("POSTs the distinct normalized food names", () => {
    enqueueMicronutrientEnrichment([
      meal([food("Spinach"), food("  spinach  "), food("Lentils")]),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const call = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0];
    expect(call[0]).toBe("/api/micronutrient-enqueue");
    const body = JSON.parse((call[1] as { body: string }).body) as {
      items: { nameKey: string }[];
    };
    const keys = body.items.map((i) => i.nameKey).sort();
    expect(keys).toEqual(["lentils", "spinach"]);
  });

  it("does not fire when there are no foods", () => {
    enqueueMicronutrientEnrichment([meal([])]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("skips blank / whitespace-only names", () => {
    enqueueMicronutrientEnrichment([meal([food("   "), food("Oats")])]);
    const call = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body) as {
      items: { nameKey: string }[];
    };
    expect(body.items.map((i) => i.nameKey)).toEqual(["oats"]);
  });

  it("never throws when fetch rejects (fire-and-forget)", () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(() =>
      enqueueMicronutrientEnrichment([meal([food("Rice")])]),
    ).not.toThrow();
  });
});
