import { foodNameKey } from "@/lib/micronutrients/aggregate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCiqualMicrosForTests,
  ciqualMicronutrients,
} from "./ciqual-micros";

// The fetch URL is irrelevant — fetch is mocked — but getAppUrl reads env, so
// stub it. foodNameKey stays real so the keying matches the cron exactly.
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "http://localhost:3000" }));

const ROWS = [
  {
    name: "Lentil, cooked",
    micronutrients: { iron: 3.3, fiber: 8, potassium: 370 },
  },
  {
    name: "Milk, whole, UHT",
    micronutrients: { calcium: 120, vitaminB12: 0.4 },
  },
];

const originalFetch = globalThis.fetch;

function mockFetch(rows: unknown, ok = true) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(rows), {
        status: ok ? 200 : 500,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("lib/ciqual-micros", () => {
  beforeEach(() => {
    __resetCiqualMicrosForTests();
    mockFetch(ROWS);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns CIQUAL micros for a matching normalized name", async () => {
    const r = await ciqualMicronutrients(foodNameKey("Lentil, cooked"));
    expect(r).toEqual({ iron: 3.3, fiber: 8, potassium: 370 });
  });

  it("returns null for a name CIQUAL doesn't cover", async () => {
    const r = await ciqualMicronutrients(
      foodNameKey("Branded Protein Bar XYZ"),
    );
    expect(r).toBeNull();
  });

  it("fetches once and caches across lookups", async () => {
    await ciqualMicronutrients(foodNameKey("Lentil, cooked"));
    await ciqualMicronutrients(foodNameKey("Milk, whole, UHT"));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("degrades to null when the asset can't be fetched", async () => {
    __resetCiqualMicrosForTests();
    mockFetch([], false);
    const r = await ciqualMicronutrients(foodNameKey("Lentil, cooked"));
    expect(r).toBeNull();
  });
});
