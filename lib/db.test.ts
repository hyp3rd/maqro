/**
 * @vitest-environment jsdom
 */
import type { Meal, PersonalInfo } from "@/components/macro/types";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshDb() {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  return await import("./db");
}

const BASELINE_PROFILE: PersonalInfo = {
  gender: "male",
  age: 30,
  weight: 70,
  height: 175,
  activityLevel: "moderate",
  goal: "maintain",
  dietType: "balanced",
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
  weeklyRateKg: 0.5,
  manualTdee: null,
  units: "metric",
};

const SAMPLE_MEALS: Meal[] = [
  {
    id: 1,
    name: "Breakfast",
    foods: [
      {
        id: 1,
        name: "Oats",
        protein: 13,
        carbs: 67,
        fat: 7,
        calories: 389,
        portionSize: 100,
      },
    ],
  },
  { id: 2, name: "Lunch", foods: [] },
  { id: 3, name: "Dinner", foods: [] },
  { id: 4, name: "Snacks", foods: [] },
];

describe("addCustomFood", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("inserts a record and returns its client-minted UUID", async () => {
    const { addCustomFood, listCustomFoods } = await freshDb();
    const id = await addCustomFood({
      name: "Whey",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
    });
    expect(typeof id).toBe("string");
    // UUID format check (8-4-4-4-12).
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const rows = await listCustomFoods();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].name).toBe("Whey");
    expect(rows[0].createdAt).toBeGreaterThan(0);
  });

  it("addCustomFood mints distinct UUIDs across calls", async () => {
    const { addCustomFood } = await freshDb();
    const a = await addCustomFood({
      name: "A",
      protein: 1,
      carbs: 1,
      fat: 1,
      calories: 17,
    });
    const b = await addCustomFood({
      name: "B",
      protein: 1,
      carbs: 1,
      fat: 1,
      calories: 17,
    });
    expect(a).not.toBe(b);
  });

  it("upsertCustomFood writes at a caller-supplied id (used by sync)", async () => {
    const { upsertCustomFood, listCustomFoods } = await freshDb();
    await upsertCustomFood({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Whey from server",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
      createdAt: Date.now(),
    });
    const rows = await listCustomFoods();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("supports searching by case-insensitive substring", async () => {
    const { addCustomFood, searchCustomFoods } = await freshDb();
    await addCustomFood({
      name: "Greek Yogurt",
      protein: 10,
      carbs: 3.6,
      fat: 0.4,
      calories: 59,
    });
    await addCustomFood({
      name: "Cottage Cheese",
      protein: 11,
      carbs: 3.4,
      fat: 4.3,
      calories: 98,
    });
    const hits = await searchCustomFoods("yogurt");
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Greek Yogurt");
    expect(hits[0].source).toBe("custom");
  });

  it("orders listCustomFoods newest-first", async () => {
    const { addCustomFood, listCustomFoods } = await freshDb();
    const a = await addCustomFood({
      name: "A",
      protein: 1,
      carbs: 1,
      fat: 1,
      calories: 17,
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await addCustomFood({
      name: "B",
      protein: 1,
      carbs: 1,
      fat: 1,
      calories: 17,
    });
    const rows = await listCustomFoods();
    expect(rows.map((r) => r.id)).toEqual([b, a]);
  });
});

describe("profile", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("returns null before any profile is saved", async () => {
    const { getProfile } = await freshDb();
    expect(await getProfile()).toBeNull();
  });

  it("round-trips a profile through saveProfile + getProfile", async () => {
    const { getProfile, saveProfile } = await freshDb();
    await saveProfile(BASELINE_PROFILE);
    const loaded = await getProfile();
    expect(loaded).toEqual(BASELINE_PROFILE);
  });

  it("does not expose the internal `_key` field on read", async () => {
    const { getProfile, saveProfile } = await freshDb();
    await saveProfile(BASELINE_PROFILE);
    const loaded = await getProfile();
    expect(loaded).not.toHaveProperty("_key");
  });

  it("overwrites on second saveProfile (single record)", async () => {
    const { getProfile, saveProfile } = await freshDb();
    await saveProfile(BASELINE_PROFILE);
    await saveProfile({ ...BASELINE_PROFILE, weight: 75 });
    const loaded = await getProfile();
    expect(loaded?.weight).toBe(75);
  });

  // The `?demo=1` seed writes the profile behind the mounted `useProfile`,
  // which re-loads only on the `profile` data-bus rev. `saveProfile` stays
  // quiet: its caller is `useProfile` itself.
  it("saveDemoProfile bumps the profile data-bus rev; saveProfile does not", async () => {
    const { saveDemoProfile, saveProfile } = await freshDb();
    const { getDataVersion } = await import("./sync/data-bus");

    await saveProfile(BASELINE_PROFILE);
    expect(getDataVersion("profile")).toBe(0);

    await saveDemoProfile(BASELINE_PROFILE);
    expect(getDataVersion("profile")).toBe(1);
  });
});

describe("daily logs", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("returns null for a day with no log", async () => {
    const { getDailyLog } = await freshDb();
    expect(await getDailyLog("2026-01-01")).toBeNull();
  });

  it("round-trips a log", async () => {
    const { getDailyLog, saveDailyLog } = await freshDb();
    await saveDailyLog("2026-05-13", SAMPLE_MEALS);
    const loaded = await getDailyLog("2026-05-13");
    expect(loaded?.date).toBe("2026-05-13");
    expect(loaded?.meals).toEqual(SAMPLE_MEALS);
    expect(loaded?.updatedAt).toBeGreaterThan(0);
  });

  it("uses the date as the key (overwrites on same-day save)", async () => {
    const { getDailyLog, saveDailyLog, listDailyLogs } = await freshDb();
    await saveDailyLog("2026-05-13", SAMPLE_MEALS);
    await saveDailyLog("2026-05-13", []);
    expect(await listDailyLogs()).toHaveLength(1);
    const loaded = await getDailyLog("2026-05-13");
    expect(loaded?.meals).toEqual([]);
  });

  it("orders listDailyLogs newest-first", async () => {
    const { saveDailyLog, listDailyLogs } = await freshDb();
    await saveDailyLog("2026-05-11", []);
    await saveDailyLog("2026-05-13", []);
    await saveDailyLog("2026-05-12", []);
    const rows = await listDailyLogs();
    expect(rows.map((r) => r.date)).toEqual([
      "2026-05-13",
      "2026-05-12",
      "2026-05-11",
    ]);
  });

  it("listDailyLogsBetween reads only the inclusive date range, oldest first", async () => {
    const { saveDailyLog, listDailyLogsBetween } = await freshDb();
    for (const date of [
      "2026-10-18",
      "2026-10-21",
      "2026-10-19",
      "2026-10-25",
      "2026-10-26",
      "2026-11-01",
    ]) {
      await saveDailyLog(date, SAMPLE_MEALS);
    }
    const rows = await listDailyLogsBetween("2026-10-19", "2026-10-25");
    expect(rows.map((r) => r.date)).toEqual([
      "2026-10-19",
      "2026-10-21",
      "2026-10-25",
    ]);
    expect(rows[0]?.meals).toEqual(SAMPLE_MEALS);
  });

  it("listDailyLogsBetween is empty for a reversed range instead of throwing", async () => {
    const { saveDailyLog, listDailyLogsBetween } = await freshDb();
    await saveDailyLog("2026-10-20", SAMPLE_MEALS);
    expect(await listDailyLogsBetween("2026-10-25", "2026-10-19")).toEqual([]);
  });

  it("dateKey produces ISO YYYY-MM-DD in local timezone", async () => {
    const { dateKey } = await freshDb();
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05"); // month is 0-indexed
    expect(dateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("meal templates", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("round-trips a template through save + list", async () => {
    const { saveMealTemplate, listMealTemplates } = await freshDb();
    const foods = SAMPLE_MEALS[0].foods;
    const id = await saveMealTemplate({ name: "Oats bowl", foods });
    expect(typeof id).toBe("string");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const rows = await listMealTemplates();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].name).toBe("Oats bowl");
    expect(rows[0].foods).toEqual(foods);
    expect(rows[0].createdAt).toBeGreaterThan(0);
    expect(rows[0].updatedAt).toBe(rows[0].createdAt);
  });

  it("orders listMealTemplates newest-first", async () => {
    const { saveMealTemplate, listMealTemplates } = await freshDb();
    const a = await saveMealTemplate({
      name: "A",
      foods: SAMPLE_MEALS[0].foods,
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveMealTemplate({
      name: "B",
      foods: SAMPLE_MEALS[0].foods,
    });
    const rows = await listMealTemplates();
    expect(rows.map((r) => r.id)).toEqual([b, a]);
  });

  it("deleteMealTemplate removes the record", async () => {
    const { saveMealTemplate, listMealTemplates, deleteMealTemplate } =
      await freshDb();
    const id = await saveMealTemplate({
      name: "Doomed",
      foods: SAMPLE_MEALS[0].foods,
    });
    await deleteMealTemplate(id);
    expect(await listMealTemplates()).toHaveLength(0);
  });

  it("saveMealTemplate returns a UUID and mints distinct values", async () => {
    const { saveMealTemplate } = await freshDb();
    const a = await saveMealTemplate({
      name: "A",
      foods: SAMPLE_MEALS[0].foods,
    });
    const b = await saveMealTemplate({
      name: "B",
      foods: SAMPLE_MEALS[0].foods,
    });
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
  });

  it("upsertMealTemplate writes at a caller-supplied id (used by sync)", async () => {
    const { upsertMealTemplate, listMealTemplates } = await freshDb();
    await upsertMealTemplate({
      id: "11111111-1111-4111-8111-111111111111",
      name: "From server",
      foods: SAMPLE_MEALS[0].foods,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const rows = await listMealTemplates();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("recipes", () => {
  beforeEach(async () => {
    await freshDb();
  });

  const sampleIngredient = {
    foodName: "Oats",
    macrosPer100g: { protein: 13, carbs: 67, fat: 7, calories: 389 },
    portionGrams: 80,
    dietKind: "plant" as const,
  };

  it("round-trips a recipe through addRecipe + listRecipes", async () => {
    const { addRecipe, listRecipes } = await freshDb();
    const id = await addRecipe({
      name: "Oats bowl",
      ingredients: [sampleIngredient],
      cuisine: "American",
      notes: "Soak overnight.",
    });
    const rows = await listRecipes();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].name).toBe("Oats bowl");
    expect(rows[0].ingredients[0].foodName).toBe("Oats");
    expect(rows[0].createdAt).toBeGreaterThan(0);
    expect(rows[0].updatedAt).toBe(rows[0].createdAt);
  });

  it("orders listRecipes newest-first by updatedAt", async () => {
    const { addRecipe, upsertRecipe, listRecipes } = await freshDb();
    const oldId = await addRecipe({ name: "Old", ingredients: [] });
    const newId = await addRecipe({ name: "New", ingredients: [] });
    // Force old to look 'just updated'
    const rows = await listRecipes();
    const old = rows.find((r) => r.id === oldId);
    expect(old).toBeDefined();
    if (!old) return;
    await upsertRecipe({ ...old, updatedAt: old.updatedAt + 10_000 });
    const ordered = await listRecipes();
    expect(ordered[0].id).toBe(oldId);
    expect(ordered[1].id).toBe(newId);
  });

  it("deleteRecipe removes the record", async () => {
    const { addRecipe, listRecipes, deleteRecipe } = await freshDb();
    const id = await addRecipe({ name: "Throwaway", ingredients: [] });
    await deleteRecipe(id);
    expect(await listRecipes()).toHaveLength(0);
  });

  it("upsertRecipe writes at a caller-supplied id (used by sync)", async () => {
    const { upsertRecipe, listRecipes } = await freshDb();
    await upsertRecipe({
      id: "22222222-2222-4222-8222-222222222222",
      name: "From server",
      ingredients: [sampleIngredient],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const rows = await listRecipes();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("22222222-2222-4222-8222-222222222222");
  });
});

describe("weight history", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("round-trips an entry through save + get", async () => {
    const { saveWeightEntry, getWeightEntry } = await freshDb();
    await saveWeightEntry("2026-05-13", 70.5);
    const row = await getWeightEntry("2026-05-13");
    expect(row?.date).toBe("2026-05-13");
    expect(row?.kg).toBe(70.5);
    expect(row?.recordedAt).toBeGreaterThan(0);
  });

  it("returns null for a date with no entry", async () => {
    const { getWeightEntry } = await freshDb();
    expect(await getWeightEntry("2026-01-01")).toBeNull();
  });

  it("overwrites on same-day save (latest wins)", async () => {
    const { saveWeightEntry, getWeightEntry, listWeightEntries } =
      await freshDb();
    await saveWeightEntry("2026-05-13", 70);
    await saveWeightEntry("2026-05-13", 71);
    expect((await getWeightEntry("2026-05-13"))?.kg).toBe(71);
    expect(await listWeightEntries()).toHaveLength(1);
  });

  it("listWeightEntries orders chronologically (oldest first)", async () => {
    const { saveWeightEntry, listWeightEntries } = await freshDb();
    await saveWeightEntry("2026-05-15", 72);
    await saveWeightEntry("2026-05-13", 70);
    await saveWeightEntry("2026-05-14", 71);
    const rows = await listWeightEntries();
    expect(rows.map((r) => r.date)).toEqual([
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
    ]);
  });

  it("deleteWeightEntry removes the record", async () => {
    const { saveWeightEntry, deleteWeightEntry, listWeightEntries } =
      await freshDb();
    await saveWeightEntry("2026-05-13", 70);
    await deleteWeightEntry("2026-05-13");
    expect(await listWeightEntries()).toHaveLength(0);
  });
});

describe("body measurements", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("round-trips a full measurement through save + get", async () => {
    const { saveBodyMeasurement, getBodyMeasurement } = await freshDb();
    await saveBodyMeasurement("2026-05-13", {
      waistCm: 82.5,
      neckCm: 38,
      hipsCm: 95,
      notes: "morning, fasted",
    });
    const row = await getBodyMeasurement("2026-05-13");
    expect(row?.date).toBe("2026-05-13");
    expect(row?.waistCm).toBe(82.5);
    expect(row?.neckCm).toBe(38);
    expect(row?.hipsCm).toBe(95);
    expect(row?.notes).toBe("morning, fasted");
  });

  it("stores partial measurements with undefined for missing fields", async () => {
    // Partial - only waist + notes. Other circumferences must NOT
    // be coerced to 0 (which would corrupt the body-fat estimator's
    // log10 input and look like a valid measurement of zero cm).
    const { saveBodyMeasurement, getBodyMeasurement } = await freshDb();
    await saveBodyMeasurement("2026-05-13", { waistCm: 82, notes: "quick" });
    const row = await getBodyMeasurement("2026-05-13");
    expect(row?.waistCm).toBe(82);
    expect(row?.neckCm).toBeUndefined();
    expect(row?.hipsCm).toBeUndefined();
    expect(row?.notes).toBe("quick");
  });

  // The app's targets read the latest body-fat estimate from this store
  // (`useLatestBodyFatPct`), which re-loads only on the data-bus rev: a
  // measurement saved or deleted here must reach them without a reload.
  it("saving or deleting a measurement bumps the bodyMeasurements rev", async () => {
    const { saveBodyMeasurement, deleteBodyMeasurement } = await freshDb();
    const { getDataVersion } = await import("./sync/data-bus");
    expect(getDataVersion("bodyMeasurements")).toBe(0);
    await saveBodyMeasurement("2026-05-13", { waistCm: 82, neckCm: 38 });
    expect(getDataVersion("bodyMeasurements")).toBe(1);
    await deleteBodyMeasurement("2026-05-13");
    expect(getDataVersion("bodyMeasurements")).toBe(2);
  });

  it("overwrites on same-day save (latest wins)", async () => {
    const { saveBodyMeasurement, getBodyMeasurement, listBodyMeasurements } =
      await freshDb();
    await saveBodyMeasurement("2026-05-13", { waistCm: 80 });
    await saveBodyMeasurement("2026-05-13", { waistCm: 82 });
    expect((await getBodyMeasurement("2026-05-13"))?.waistCm).toBe(82);
    expect(await listBodyMeasurements()).toHaveLength(1);
  });

  it("listBodyMeasurements orders chronologically", async () => {
    const { saveBodyMeasurement, listBodyMeasurements } = await freshDb();
    await saveBodyMeasurement("2026-05-15", { waistCm: 82 });
    await saveBodyMeasurement("2026-05-13", { waistCm: 80 });
    await saveBodyMeasurement("2026-05-14", { waistCm: 81 });
    const rows = await listBodyMeasurements();
    expect(rows.map((r) => r.date)).toEqual([
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
    ]);
  });

  it("deleteBodyMeasurement removes the record", async () => {
    const { saveBodyMeasurement, deleteBodyMeasurement, listBodyMeasurements } =
      await freshDb();
    await saveBodyMeasurement("2026-05-13", { waistCm: 82 });
    await deleteBodyMeasurement("2026-05-13");
    expect(await listBodyMeasurements()).toHaveLength(0);
  });
});

describe("training day overrides", () => {
  const LEGS = { type: "lower", intensity: "hard", durationMin: 75 } as const;

  it("round-trips a session through save + get, keyed by date", async () => {
    const { saveDayOverride, getDayOverride } = await freshDb();
    await saveDayOverride("2026-10-22", LEGS);
    const row = await getDayOverride("2026-10-22");
    expect(row?.date).toBe("2026-10-22");
    expect(row?.day).toEqual(LEGS);
    expect(typeof row?.recordedAt).toBe("number");
    // A local write is dirty until the next push acknowledges it.
    expect(row?.serverUpdatedAt).toBeNull();
    expect(await getDayOverride("2026-10-23")).toBeNull();
  });

  it("overwrites on same-day save and lists oldest first", async () => {
    const { saveDayOverride, listDayOverrides } = await freshDb();
    await saveDayOverride("2026-10-22", LEGS);
    await saveDayOverride("2026-10-21", { type: "rest" });
    await saveDayOverride("2026-10-22", { type: "rest" });
    const rows = await listDayOverrides();
    expect(rows.map((r) => [r.date, r.day.type])).toEqual([
      ["2026-10-21", "rest"],
      ["2026-10-22", "rest"],
    ]);
  });

  it("back to plan deletes the row and leaves a tombstone for the sync", async () => {
    const {
      saveDayOverride,
      deleteDayOverride,
      listDayOverrides,
      listDeletions,
    } = await freshDb();
    await saveDayOverride("2026-10-22", LEGS);
    await deleteDayOverride("2026-10-22");
    expect(await listDayOverrides()).toHaveLength(0);
    expect((await listDeletions()).map((t) => [t.storeName, t.rowKey])).toEqual(
      [["trainingDayOverrides", "2026-10-22"]],
    );
  });

  // Every target reads overrides through the data bus (`useDayOverrides`),
  // so a local change must reach them without a reload.
  it("saving or deleting an override bumps the trainingDayOverrides rev", async () => {
    const { saveDayOverride, deleteDayOverride } = await freshDb();
    const { getDataVersion } = await import("./sync/data-bus");
    expect(getDataVersion("trainingDayOverrides")).toBe(0);
    await saveDayOverride("2026-10-22", LEGS);
    expect(getDataVersion("trainingDayOverrides")).toBe(1);
    await deleteDayOverride("2026-10-22");
    expect(getDataVersion("trainingDayOverrides")).toBe(2);
  });

  it("a server row lands clean and is not re-pushed; a pending tombstone blocks it", async () => {
    const db = await freshDb();
    const at = "2026-10-22T08:00:00.000+00:00";
    expect(await db.applyServerDayOverride("2026-10-22", LEGS, at)).toBe(
      "applied",
    );
    const row = await db.getDayOverride("2026-10-22");
    expect(row?.day).toEqual(LEGS);
    expect(row?.localUpdatedAt).toBe(at);
    expect(row?.serverUpdatedAt).toBe(at);

    await db.deleteDayOverride("2026-10-22");
    expect(
      await db.applyServerDayOverride(
        "2026-10-22",
        LEGS,
        "2026-10-22T09:00:00.000+00:00",
      ),
    ).toBe("tombstoned");
    expect(await db.getDayOverride("2026-10-22")).toBeNull();
  });

  it("clearAllStores and the demo clear both drop overrides", async () => {
    const db = await freshDb();
    await db.saveDayOverride("2026-10-22", LEGS);
    await db.clearAllStores();
    expect(await db.listDayOverrides()).toHaveLength(0);

    // An override made while exploring the sample profile's training week
    // is demo data: it must not reach the account signed in next.
    await db.saveDayOverride("2026-10-22", LEGS);
    await db.clearDemoSeededStores();
    expect(await db.listDayOverrides()).toHaveLength(0);
  });

  it("the demo clear drops a demo 'back to plan' tombstone too", async () => {
    const db = await freshDb();
    await db.saveDayOverride("2026-10-22", LEGS);
    await db.deleteDayOverride("2026-10-22");
    // A tombstone for a store that is not wiped stays: that row was the
    // guest's own data and the delete still has to reach the account.
    const foodId = await db.addCustomFood({
      name: "Whey",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
    });
    await db.deleteCustomFood(foodId);

    await db.clearDemoSeededStores();

    // Replayed after sign-in, the override's tombstone would delete the
    // account's real override for that date.
    expect(
      (await db.listDeletions()).map((d) => [d.storeName, d.rowKey]),
    ).toEqual([["customFoods", foodId]]);
  });
});

describe("clearAllStores", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("empties every store in one shot", async () => {
    const db = await freshDb();
    await db.saveProfile(BASELINE_PROFILE);
    await db.saveDailyLog("2026-05-13", SAMPLE_MEALS);
    await db.saveWeightEntry("2026-05-13", 70);
    await db.addCustomFood({
      name: "Whey",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
    });
    await db.saveMealTemplate({
      name: "Oats bowl",
      foods: SAMPLE_MEALS[0].foods,
    });
    await db.addRecipe({
      name: "Throwaway",
      ingredients: [
        {
          foodName: "Oats",
          macrosPer100g: { protein: 13, carbs: 67, fat: 7, calories: 389 },
          portionGrams: 80,
          dietKind: "plant",
        },
      ],
    });

    await db.clearAllStores();

    expect(await db.getProfile()).toBeNull();
    expect(await db.listDailyLogs()).toHaveLength(0);
    expect(await db.listWeightEntries()).toHaveLength(0);
    expect(await db.listCustomFoods()).toHaveLength(0);
    expect(await db.listMealTemplates()).toHaveLength(0);
    expect(await db.listRecipes()).toHaveLength(0);
  });

  it("empties every object store the live database holds", async () => {
    const db = await freshDb();
    // Any call opens the module's connection, which runs the upgrade chain.
    await db.listCustomFoods();
    // A second connection at the current version reads the store list the
    // upgrade actually produced, so a store added later is covered without
    // editing this test.
    const raw = await openDB("maqro");
    try {
      const storeNames = Array.from(raw.objectStoreNames);
      expect(storeNames).toContain("mealSchedules");
      for (const name of storeNames) {
        const store = raw.transaction(name, "readwrite").store;
        const { keyPath } = store;
        if (typeof keyPath !== "string") {
          throw new Error(`store ${name} has an unexpected keyPath`);
        }
        await store.put({ [keyPath]: `seed-${name}` });
        expect(await store.count()).toBe(1);
      }

      await db.clearAllStores();

      const leftovers: Record<string, number> = {};
      for (const name of storeNames) {
        const count = await raw.count(name);
        if (count > 0) leftovers[name] = count;
      }
      expect(leftovers).toEqual({});
    } finally {
      raw.close();
    }
  });

  it("is idempotent - running on an already-empty DB is a no-op", async () => {
    const { clearAllStores, listCustomFoods } = await freshDb();
    await clearAllStores();
    await clearAllStores();
    expect(await listCustomFoods()).toHaveLength(0);
  });
});

describe("computeSortBetween - fractional indexing for drag-and-drop", () => {
  it("returns a number when both neighbors are null (first item ever)", async () => {
    const { computeSortBetween } = await import("./db");
    const v = computeSortBetween(null, null);
    expect(typeof v).toBe("number");
    expect(Number.isFinite(v)).toBe(true);
  });

  it("returns the midpoint when both neighbors have values", async () => {
    const { computeSortBetween } = await import("./db");
    expect(computeSortBetween(10, 20)).toBe(15);
    expect(computeSortBetween(0, 1)).toBe(0.5);
    expect(computeSortBetween(-5, 5)).toBe(0);
  });

  it("subtracts 1 when prepending (no left neighbor)", async () => {
    const { computeSortBetween } = await import("./db");
    expect(computeSortBetween(null, 10)).toBe(9);
  });

  it("adds 1 when appending (no right neighbor)", async () => {
    const { computeSortBetween } = await import("./db");
    expect(computeSortBetween(10, null)).toBe(11);
  });

  it("treats undefined the same as null (so callers can spread `row.sortOrder`)", async () => {
    const { computeSortBetween } = await import("./db");
    expect(computeSortBetween(undefined, undefined)).toBeGreaterThan(0);
    expect(computeSortBetween(undefined, 10)).toBe(9);
    expect(computeSortBetween(10, undefined)).toBe(11);
  });

  it("can keep subdividing without renumbering (the whole point of fractional indexing)", async () => {
    const { computeSortBetween } = await import("./db");
    let a = 0;
    const b = 1;
    for (let i = 0; i < 20; i++) {
      const mid = computeSortBetween(a, b);
      expect(mid).toBeGreaterThan(a);
      expect(mid).toBeLessThan(b);
      a = mid; // keep subdividing into the lower half
    }
  });
});

describe("deletion tombstones (Pass A - silent-resurrection bug)", () => {
  it("writes a tombstone when deleteCustomFood is called", async () => {
    const { addCustomFood, deleteCustomFood, listDeletions } = await freshDb();
    const id = await addCustomFood({
      name: "Whey",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
    });

    await deleteCustomFood(id);

    const tombstones = await listDeletions();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].storeName).toBe("customFoods");
    expect(tombstones[0].rowKey).toBe(id);
    expect(tombstones[0]._key).toBe(`customFoods:${id}`);
  });

  it("writes a tombstone for each deletable store type", async () => {
    const {
      addCustomFood,
      deleteCustomFood,
      saveMealTemplate,
      deleteMealTemplate,
      addRecipe,
      deleteRecipe,
      saveDailyLog,
      deleteDailyLog,
      saveWeightEntry,
      deleteWeightEntry,
      listDeletions,
    } = await freshDb();

    const foodId = await addCustomFood({
      name: "x",
      protein: 0,
      carbs: 0,
      fat: 0,
      calories: 0,
    });
    const tmplId = await saveMealTemplate({ name: "t", foods: [] });
    const recipeId = await addRecipe({ name: "r", ingredients: [] });
    await saveDailyLog("2026-05-13", []);
    await saveWeightEntry("2026-05-13", 80);

    await deleteCustomFood(foodId);
    await deleteMealTemplate(tmplId);
    await deleteRecipe(recipeId);
    await deleteDailyLog("2026-05-13");
    await deleteWeightEntry("2026-05-13");

    const tombs = await listDeletions();
    const stores = tombs.map((t) => t.storeName).sort();
    expect(stores).toEqual([
      "customFoods",
      "dailyLogs",
      "mealTemplates",
      "recipes",
      "weightHistory",
    ]);
  });

  it("applyServerDeletion removes the row WITHOUT writing a tombstone (realtime echo path)", async () => {
    const {
      applyServerCustomFood,
      applyServerDeletion,
      listCustomFoods,
      listDeletions,
    } = await freshDb();
    // A clean, previously-synced row (a dirty one is kept — see below).
    const id = "11111111-2222-4333-8444-555555555555";
    await applyServerCustomFood(
      {
        id,
        name: "Whey",
        protein: 80,
        carbs: 8,
        fat: 2,
        calories: 370,
        createdAt: 0,
      },
      "2026-05-16T12:00:00Z",
    );

    expect(await applyServerDeletion("customFoods", id)).toBe("deleted");

    // The IDB row is gone…
    expect(await listCustomFoods()).toHaveLength(0);
    // …and crucially no tombstone was written. (If realtime's DELETE
    // handler wrote a tombstone we'd echo a redundant DELETE back to
    // the server on the next sync.)
    expect(await listDeletions()).toHaveLength(0);
  });

  it("applyServerDeletion keeps a dirty row and re-queues it as an insert (local edit wins over a remote delete)", async () => {
    const {
      applyServerCustomFood,
      applyServerDeletion,
      listCustomFoods,
      upsertCustomFood,
    } = await freshDb();
    const id = "11111111-2222-4333-8444-555555555555";
    const food = {
      id,
      name: "Whey",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
      createdAt: 0,
    };
    await applyServerCustomFood(food, "2026-05-16T12:00:00Z");
    await upsertCustomFood({ ...food, name: "Whey isolate" }); // dirty

    expect(await applyServerDeletion("customFoods", id)).toBe("kept-dirty");

    const [kept] = await listCustomFoods();
    expect(kept?.name).toBe("Whey isolate");
    // Base token cleared → the next push upserts it back.
    expect(kept?.serverUpdatedAt).toBeNull();
  });

  it("applyServerDeletion also clears a pre-existing tombstone (delete already in flight, peer confirmed)", async () => {
    const {
      addCustomFood,
      deleteCustomFood,
      applyServerDeletion,
      listDeletions,
    } = await freshDb();
    const id = await addCustomFood({
      name: "Whey",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
    });

    await deleteCustomFood(id); // tombstone written
    expect(await listDeletions()).toHaveLength(1);

    // Realtime then echoes our own DELETE (or a peer's). The
    // tombstone is now redundant.
    await applyServerDeletion("customFoods", id);
    expect(await listDeletions()).toHaveLength(0);
  });

  it("clearAllStores wipes pending tombstones along with the data (delete-account flow)", async () => {
    const { addCustomFood, deleteCustomFood, clearAllStores, listDeletions } =
      await freshDb();
    const id = await addCustomFood({
      name: "Whey",
      protein: 80,
      carbs: 8,
      fat: 2,
      calories: 370,
    });
    await deleteCustomFood(id);

    await clearAllStores();
    expect(await listDeletions()).toHaveLength(0);
  });
});

describe("shoppingListMeta", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("inserts a new row with normalized lowercased key", async () => {
    const db = await freshDb();
    await db.upsertShoppingListMeta("  Olive Oil  ", {
      notes: "1 L bottle",
      extraQty: 1,
      extraUnit: "L",
    });
    const rows = await db.listShoppingListMeta();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("olive oil");
    expect(rows[0]?.notes).toBe("1 L bottle");
    expect(rows[0]?.extraQty).toBe(1);
    expect(rows[0]?.extraUnit).toBe("L");
  });

  it("merges partial patches without clobbering unrelated fields", async () => {
    const db = await freshDb();
    await db.upsertShoppingListMeta("Tomato", {
      notes: "fresh",
      extraQty: 3,
      extraUnit: "cans",
    });
    // Now overwrite only the notes — qty + unit must survive.
    await db.upsertShoppingListMeta("Tomato", { notes: "very ripe" });
    const [row] = await db.listShoppingListMeta();
    expect(row?.notes).toBe("very ripe");
    expect(row?.extraQty).toBe(3);
    expect(row?.extraUnit).toBe("cans");
  });

  it("null sentinel clears a single field; siblings stay intact", async () => {
    const db = await freshDb();
    await db.upsertShoppingListMeta("Bread", {
      notes: "wholegrain",
      extraQty: 2,
      extraUnit: "loaves",
    });
    await db.upsertShoppingListMeta("Bread", { extraQty: null });
    const [row] = await db.listShoppingListMeta();
    expect(row?.extraQty).toBeUndefined();
    // extraUnit is left dangling on purpose — the UI treats
    // qty-zero rows as "not an extra" so the unit becomes harmless.
    expect(row?.notes).toBe("wholegrain");
  });

  it("excluded boolean roundtrips through the null-clear merge", async () => {
    const db = await freshDb();
    await db.upsertShoppingListMeta("Milk", { excluded: true });
    let [row] = await db.listShoppingListMeta();
    expect(row?.excluded).toBe(true);
    await db.upsertShoppingListMeta("Milk", { excluded: null });
    [row] = await db.listShoppingListMeta();
    expect(row?.excluded).toBeUndefined();
  });

  it("appearancesOverride persists, merges, and null-clears like other numeric fields", async () => {
    const db = await freshDb();
    await db.upsertShoppingListMeta("Yogurt", {
      qtyOverride: 500,
      appearancesOverride: 4,
    });
    let [row] = await db.listShoppingListMeta();
    expect(row?.qtyOverride).toBe(500);
    expect(row?.appearancesOverride).toBe(4);
    // Touch only one field — the other must survive the merge.
    await db.upsertShoppingListMeta("Yogurt", { appearancesOverride: 7 });
    [row] = await db.listShoppingListMeta();
    expect(row?.qtyOverride).toBe(500);
    expect(row?.appearancesOverride).toBe(7);
    // Null clears the field on its own.
    await db.upsertShoppingListMeta("Yogurt", { appearancesOverride: null });
    [row] = await db.listShoppingListMeta();
    expect(row?.appearancesOverride).toBeUndefined();
    expect(row?.qtyOverride).toBe(500);
  });

  it("deleteShoppingListMeta removes the row entirely", async () => {
    const db = await freshDb();
    await db.upsertShoppingListMeta("Eggs", {
      category: "Dairy & Eggs",
      notes: "free range",
    });
    expect(await db.listShoppingListMeta()).toHaveLength(1);
    await db.deleteShoppingListMeta("EGGS");
    expect(await db.listShoppingListMeta()).toHaveLength(0);
  });

  it("clearAllStores wipes the shoppingListMeta store too", async () => {
    const db = await freshDb();
    await db.upsertShoppingListMeta("Apples", { extraQty: 4, extraUnit: "" });
    expect(await db.listShoppingListMeta()).toHaveLength(1);
    await db.clearAllStores();
    expect(await db.listShoppingListMeta()).toHaveLength(0);
  });
});

// A load-then-save round trip (a hook re-saving what it just read) must not
// turn a clean, server-mirrored row dirty: a dirty row is never overwritten
// by server data, so every later peer update would be kept out ("kept-dirty")
// and the next sync would report a false conflict.
describe("a save that changes no server-owned content leaves the row clean", () => {
  const DAY = "2026-05-16";
  const V2 = "2026-05-16T12:00:02.000000+00:00";
  const V3 = "2026-05-16T12:00:03.000000+00:00";
  type Db = Awaited<ReturnType<typeof freshDb>>;
  const PANTRY = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Rice",
    quantity: 500,
    unit: "g",
    createdAt: 1,
    updatedAt: 1,
  };
  const STORE = {
    id: "node/123",
    name: "Corner shop",
    kind: "grocery",
    lat: 45,
    lon: 9,
    createdAt: 1,
    updatedAt: 1,
  };
  const FOOD = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Whey",
    protein: 80,
    carbs: 8,
    fat: 2,
    calories: 370,
    createdAt: 1,
  };

  const cases: Array<{
    name: string;
    applyV2: (db: Db) => Promise<unknown>;
    resave: (db: Db) => Promise<void>;
    applyV3: (db: Db) => Promise<unknown>;
    read: (db: Db) => Promise<unknown>;
    expected: unknown;
  }> = [
    {
      name: "saveDailyLog",
      applyV2: (db) => db.applyServerDailyLog(DAY, SAMPLE_MEALS, V2),
      resave: (db) => db.saveDailyLog(DAY, structuredClone(SAMPLE_MEALS)),
      applyV3: (db) => db.applyServerDailyLog(DAY, [], V3),
      read: async (db) => (await db.getDailyLog(DAY))?.meals,
      expected: [],
    },
    {
      name: "saveProfile",
      applyV2: (db) => db.applyServerProfile(BASELINE_PROFILE, V2),
      resave: (db) => db.saveProfile({ ...BASELINE_PROFILE }),
      applyV3: (db) =>
        db.applyServerProfile({ ...BASELINE_PROFILE, age: 31 }, V3),
      read: async (db) => (await db.getProfile())?.age,
      expected: 31,
    },
    {
      name: "saveWeightEntry",
      applyV2: (db) => db.applyServerWeightEntry(DAY, 70, V2),
      resave: (db) => db.saveWeightEntry(DAY, 70),
      applyV3: (db) => db.applyServerWeightEntry(DAY, 71, V3),
      read: async (db) => (await db.getWeightEntry(DAY))?.kg,
      expected: 71,
    },
    {
      name: "setWaterTotal / addWater(0)",
      applyV2: (db) => db.applyServerWaterIntake(DAY, 500, V2),
      resave: async (db) => {
        await db.setWaterTotal(DAY, 500);
        await db.addWater(DAY, 0);
      },
      applyV3: (db) => db.applyServerWaterIntake(DAY, 750, V3),
      read: async (db) => (await db.getWaterIntake(DAY))?.ml,
      expected: 750,
    },
    {
      name: "upsertPantryItem",
      applyV2: (db) => db.applyServerPantryItem(PANTRY, V2),
      resave: (db) => db.upsertPantryItem({ ...PANTRY }),
      applyV3: (db) =>
        db.applyServerPantryItem({ ...PANTRY, quantity: 250 }, V3),
      read: async (db) => (await db.listPantryItems())[0]?.quantity,
      expected: 250,
    },
    {
      name: "upsertFavoriteStore",
      applyV2: (db) => db.applyServerFavoriteStore(STORE, V2),
      resave: (db) => db.upsertFavoriteStore({ ...STORE }),
      applyV3: (db) =>
        db.applyServerFavoriteStore({ ...STORE, name: "Renamed" }, V3),
      read: async (db) => (await db.listFavoriteStores())[0]?.name,
      expected: "Renamed",
    },
    {
      name: "upsertCustomFood / setSortOrder to the same value",
      applyV2: (db) => db.applyServerCustomFood({ ...FOOD, sortOrder: 5 }, V2),
      resave: async (db) => {
        await db.upsertCustomFood({ ...FOOD, sortOrder: 5 });
        await db.setSortOrder("customFoods", FOOD.id, 5);
      },
      applyV3: (db) =>
        db.applyServerCustomFood({ ...FOOD, sortOrder: 5, name: "Casein" }, V3),
      read: async (db) => (await db.listCustomFoods())[0]?.name,
      expected: "Casein",
    },
  ];

  it.each(cases)(
    "$name: apply v2, re-save the same content, apply v3 → applied",
    async ({ applyV2, resave, applyV3, read, expected }) => {
      const db = await freshDb();
      expect(await applyV2(db)).toBe("applied");

      await resave(db);

      expect(await applyV3(db)).toBe("applied");
      expect(await read(db)).toEqual(expected);
    },
  );

  it("a re-save keeps the row's version tokens, so it stays clean", async () => {
    const db = await freshDb();
    await db.applyServerDailyLog(DAY, SAMPLE_MEALS, V2);

    await db.saveDailyLog(DAY, structuredClone(SAMPLE_MEALS));

    const row = await db.getDailyLog(DAY);
    expect(row?.localUpdatedAt).toBe(V2);
    expect(row?.serverUpdatedAt).toBe(V2);
    expect(row && db.isDirtyRecord(row)).toBe(false);
  });

  it("a real edit still dirties the row and keeps its base", async () => {
    const db = await freshDb();
    await db.applyServerDailyLog(DAY, SAMPLE_MEALS, V2);

    await db.saveDailyLog(DAY, []);

    const row = await db.getDailyLog(DAY);
    expect(row?.serverUpdatedAt).toBe(V2);
    expect(row && db.isDirtyRecord(row)).toBe(true);
    expect(await db.applyServerDailyLog(DAY, SAMPLE_MEALS, V3)).toBe(
      "kept-dirty",
    );
  });

  it("re-saving a dirty row's own content keeps it dirty on the same base", async () => {
    const db = await freshDb();
    await db.applyServerDailyLog(DAY, SAMPLE_MEALS, V2);
    await db.saveDailyLog(DAY, []);
    const edited = await db.getDailyLog(DAY);

    await db.saveDailyLog(DAY, []);

    const row = await db.getDailyLog(DAY);
    expect(row?.localUpdatedAt).toBe(edited?.localUpdatedAt);
    expect(row?.serverUpdatedAt).toBe(V2);
    expect(row && db.isDirtyRecord(row)).toBe(true);
  });

  it("saveDemoProfile still marks an unchanged profile as demo-seeded without dirtying it", async () => {
    const db = await freshDb();
    await db.applyServerProfile(BASELINE_PROFILE, V2);

    await db.saveDemoProfile({ ...BASELINE_PROFILE });

    expect(await db.isProfileMarkedAsDemo()).toBe(true);
    const row = await db.getProfileRecord();
    expect(row && db.isDirtyRecord(row)).toBe(false);
  });
});
