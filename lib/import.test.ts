/**
 * @vitest-environment jsdom
 */
import type { PersonalInfo } from "@/components/macro/types";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshDb() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  return await import("./db");
}

const SAMPLE_PROFILE: PersonalInfo = {
  gender: "female",
  age: 28,
  weight: 60,
  height: 165,
  activityLevel: "active",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "pescatarian",
  cuisinePreferences: ["Italian"],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0,
  manualTdee: null,
  units: "metric",
};

const SAMPLE_FOOD_ITEM = {
  id: 1,
  name: "Oats",
  protein: 13,
  carbs: 67,
  fat: 7,
  calories: 389,
  portionSize: 100,
};

describe("parseBundle", () => {
  it("accepts a well-formed v1 bundle", async () => {
    const { parseBundle } = await import("./import");
    const bundle = {
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      user: null,
      data: {},
    };
    expect(parseBundle(bundle)).toBeTruthy();
  });

  it("accepts a well-formed v2 bundle", async () => {
    const { parseBundle } = await import("./import");
    const bundle = { version: 2, data: {} };
    expect(parseBundle(bundle).version).toBe(2);
  });

  it("accepts a well-formed v3 bundle", async () => {
    const { parseBundle } = await import("./import");
    const bundle = { version: 3, data: {} };
    expect(parseBundle(bundle).version).toBe(3);
  });

  it("rejects an object with no version", async () => {
    const { parseBundle } = await import("./import");
    expect(() => parseBundle({ data: {} })).toThrow(/version/);
  });

  it("rejects an unknown version", async () => {
    const { parseBundle } = await import("./import");
    expect(() => parseBundle({ version: 99, data: {} })).toThrow(
      /Unsupported export version/,
    );
  });

  it("rejects a non-object", async () => {
    const { parseBundle } = await import("./import");
    expect(() => parseBundle("hello")).toThrow(/not a JSON object/);
    expect(() => parseBundle([1, 2, 3])).toThrow(/not a JSON object/);
  });

  it("rejects when data is missing", async () => {
    const { parseBundle } = await import("./import");
    expect(() => parseBundle({ version: 1 })).toThrow(/`data` object/);
  });
});

describe("importBundle - happy path round-trips", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("imports a v2 bundle and every row lands in IDB", async () => {
    const db = await freshDb();
    const { importBundle } = await import("./import");

    const bundle = {
      version: 2,
      exportedAt: "2026-01-01T00:00:00.000Z",
      user: null,
      data: {
        profile: SAMPLE_PROFILE,
        dailyLogs: [
          {
            date: "2026-05-15",
            meals: [{ id: 1, name: "Breakfast", foods: [SAMPLE_FOOD_ITEM] }],
            updatedAt: 1_700_000_000_000,
          },
        ],
        weightHistory: [
          { date: "2026-05-15", kg: 70.2, recordedAt: 1_700_000_000_000 },
        ],
        customFoods: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Whey",
            protein: 80,
            carbs: 8,
            fat: 2,
            calories: 370,
            createdAt: 1_700_000_000_000,
          },
        ],
        mealTemplates: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Oat bowl",
            foods: [SAMPLE_FOOD_ITEM],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
          },
        ],
        recipes: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Chicken & oats",
            ingredients: [
              {
                foodName: "Oats",
                macrosPer100g: {
                  protein: 13,
                  carbs: 67,
                  fat: 7,
                  calories: 389,
                },
                portionGrams: 80,
                dietKind: "plant",
              },
            ],
            cuisine: "American",
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
          },
        ],
      },
    };

    const result = await importBundle(bundle);
    expect(result.imported.profile).toBe(1);
    expect(result.imported.dailyLogs).toBe(1);
    expect(result.imported.weightEntries).toBe(1);
    expect(result.imported.customFoods).toBe(1);
    expect(result.imported.mealTemplates).toBe(1);
    expect(result.imported.recipes).toBe(1);
    expect(result.skipped).toHaveLength(0);

    expect(await db.getProfile()).toMatchObject({
      gender: "female",
      dietPreference: "pescatarian",
    });
    expect(await db.listDailyLogs()).toHaveLength(1);
    expect(await db.listWeightEntries()).toHaveLength(1);
    expect(await db.listCustomFoods()).toHaveLength(1);
    expect(await db.listMealTemplates()).toHaveLength(1);
    expect(await db.listRecipes()).toHaveLength(1);
  });

  it("imports a v3 bundle's body measurements, water, and blood pressure", async () => {
    const db = await freshDb();
    const { importBundle } = await import("./import");

    const bundle = {
      version: 3,
      exportedAt: "2026-01-01T00:00:00.000Z",
      user: null,
      data: {
        bodyMeasurements: [
          {
            date: "2026-05-15",
            waistCm: 82,
            neckCm: 38,
            hipsCm: 95,
            notes: "am",
            recordedAt: 1_700_000_000_000,
          },
        ],
        waterIntake: [
          { date: "2026-05-15", ml: 2300, recordedAt: 1_700_000_000_000 },
        ],
        bloodPressure: [
          {
            date: "2026-05-15",
            systolic: 122,
            diastolic: 78,
            pulse: 64,
            recordedAt: 1_700_000_000_000,
          },
        ],
      },
    };

    const result = await importBundle(bundle);
    expect(result.imported.bodyMeasurements).toBe(1);
    expect(result.imported.waterIntake).toBe(1);
    expect(result.imported.bloodPressure).toBe(1);
    expect(result.skipped).toHaveLength(0);

    expect(await db.listBodyMeasurements()).toHaveLength(1);
    expect((await db.getWaterIntake("2026-05-15"))?.ml).toBe(2300);
    expect(await db.listBloodPressure()).toMatchObject([
      { systolic: 122, diastolic: 78, pulse: 64 },
    ]);
  });

  it("imports a v1 bundle (no recipes field) without error", async () => {
    const db = await freshDb();
    const { importBundle } = await import("./import");
    const result = await importBundle({
      version: 1,
      data: {
        profile: SAMPLE_PROFILE,
        dailyLogs: [],
        weightHistory: [],
        customFoods: [],
        mealTemplates: [],
      },
    });
    expect(result.imported.profile).toBe(1);
    expect(result.imported.recipes).toBe(0);
    expect(await db.listRecipes()).toHaveLength(0);
  });

  it("upserts at existing id so re-importing the same bundle is idempotent", async () => {
    const db = await freshDb();
    const { importBundle } = await import("./import");
    const id = "44444444-4444-4444-8444-444444444444";
    const bundle = {
      version: 2,
      data: {
        customFoods: [
          {
            id,
            name: "Whey",
            protein: 80,
            carbs: 8,
            fat: 2,
            calories: 370,
            createdAt: 1_700_000_000_000,
          },
        ],
      },
    };
    await importBundle(bundle);
    await importBundle(bundle);
    const foods = await db.listCustomFoods();
    expect(foods).toHaveLength(1);
    expect(foods[0].id).toBe(id);
  });
});

describe("importBundle - validation", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("skips a malformed daily log without aborting the import", async () => {
    const db = await freshDb();
    const { importBundle } = await import("./import");
    const result = await importBundle({
      version: 2,
      data: {
        dailyLogs: [
          // valid
          {
            date: "2026-05-15",
            meals: [{ id: 1, name: "Breakfast", foods: [SAMPLE_FOOD_ITEM] }],
            updatedAt: 0,
          },
          // wrong date format → skipped
          { date: "yesterday", meals: [], updatedAt: 0 },
        ],
      },
    });
    expect(result.imported.dailyLogs).toBe(1);
    expect(result.skipped).toEqual([
      { table: "dailyLogs", reason: "malformed" },
    ]);
    expect(await db.listDailyLogs()).toHaveLength(1);
  });

  it("treats a malformed profile as skipped, not fatal", async () => {
    const { importBundle } = await import("./import");
    const result = await importBundle({
      version: 2,
      data: {
        profile: { gender: 42 }, // wrong type → not a valid PersonalInfo
        customFoods: [],
      },
    });
    expect(result.imported.profile).toBe(0);
    expect(result.skipped[0]).toEqual({
      table: "profile",
      reason: "malformed",
    });
  });
});

describe("planImport - diff against local IDB state", () => {
  beforeEach(async () => {
    await freshDb();
  });

  const sampleCustom = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Whey",
    protein: 80,
    carbs: 8,
    fat: 2,
    calories: 370,
    createdAt: 1_700_000_000_000,
  };

  it("reports profile as 'absent' when the bundle has none", async () => {
    await freshDb();
    const { planImport } = await import("./import");
    const plan = await planImport({ version: 2, data: {} });
    expect(plan.tables.profile).toEqual({ kind: "absent" });
  });

  it("reports profile as 'new' when bundle has one but local is empty", async () => {
    await freshDb();
    const { planImport } = await import("./import");
    const plan = await planImport({
      version: 2,
      data: { profile: SAMPLE_PROFILE },
    });
    expect(plan.tables.profile).toEqual({ kind: "new" });
  });

  it("reports profile as 'unchanged' when local matches bundle", async () => {
    const db = await freshDb();
    await db.saveProfile(SAMPLE_PROFILE);
    const { planImport } = await import("./import");
    const plan = await planImport({
      version: 2,
      data: { profile: SAMPLE_PROFILE },
    });
    expect(plan.tables.profile).toEqual({ kind: "unchanged" });
  });

  it("reports profile as 'updated' when local differs from bundle", async () => {
    const db = await freshDb();
    await db.saveProfile(SAMPLE_PROFILE);
    const { planImport } = await import("./import");
    const plan = await planImport({
      version: 2,
      data: { profile: { ...SAMPLE_PROFILE, age: 99 } },
    });
    expect(plan.tables.profile).toEqual({ kind: "updated" });
  });

  it("buckets custom foods into new / updated / unchanged / skipped", async () => {
    const db = await freshDb();
    await db.upsertCustomFood(sampleCustom);
    const { planImport } = await import("./import");
    const plan = await planImport({
      version: 2,
      data: {
        customFoods: [
          // unchanged - same id + same content
          sampleCustom,
          // updated - same id, different protein
          { ...sampleCustom, protein: 75 },
          // new - id not in local
          {
            ...sampleCustom,
            id: "22222222-2222-4222-8222-222222222222",
            name: "Casein",
          },
          // skipped - malformed
          { id: "33333333-3333-4333-8333-333333333333" },
        ],
      },
    });
    // First two share an id so the second wins in the diff (updated).
    // The third is brand-new; the fourth is malformed.
    expect(plan.tables.customFoods.new).toBe(1);
    expect(plan.tables.customFoods.updated).toBe(1);
    expect(plan.tables.customFoods.skipped).toBe(1);
  });

  it("treats createdAt drift on custom foods as 'unchanged' (the field doesn't matter for content)", async () => {
    const db = await freshDb();
    await db.upsertCustomFood(sampleCustom);
    const { planImport } = await import("./import");
    const plan = await planImport({
      version: 2,
      data: { customFoods: [{ ...sampleCustom, createdAt: 9_999_999_999 }] },
    });
    expect(plan.tables.customFoods.unchanged).toBe(1);
    expect(plan.tables.customFoods.updated).toBe(0);
  });

  it("dedups daily logs by date when the bundle has duplicates", async () => {
    await freshDb();
    const { planImport } = await import("./import");
    const log = {
      date: "2026-05-15",
      meals: [{ id: 1, name: "Breakfast", foods: [SAMPLE_FOOD_ITEM] }],
      updatedAt: 0,
    };
    const plan = await planImport({
      version: 2,
      data: { dailyLogs: [log, log] },
    });
    expect(plan.tables.dailyLogs.new).toBe(1);
  });

  it("reports the bundle's version and exportedAt", async () => {
    await freshDb();
    const { planImport } = await import("./import");
    const plan = await planImport({
      version: 2,
      exportedAt: "2026-05-15T10:30:00.000Z",
      data: {},
    });
    expect(plan.version).toBe(2);
    expect(plan.exportedAt).toBe("2026-05-15T10:30:00.000Z");
  });
});

describe("importBundle - progress callback", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("emits a 'done' event last and visits every other phase", async () => {
    await freshDb();
    const { importBundle } = await import("./import");
    const events: string[] = [];
    await importBundle(
      { version: 2, data: { profile: SAMPLE_PROFILE, customFoods: [] } },
      (e) => events.push(e.phase),
    );
    // Every phase appears at least once; the final event is 'done'.
    const unique = [...new Set(events)];
    expect(unique).toContain("profile");
    expect(unique).toContain("dailyLogs");
    expect(unique).toContain("weightHistory");
    expect(unique).toContain("customFoods");
    expect(unique).toContain("mealTemplates");
    expect(unique).toContain("recipes");
    expect(events[events.length - 1]).toBe("done");
  });
});
