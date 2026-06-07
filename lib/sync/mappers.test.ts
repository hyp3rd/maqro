import type { PersonalInfo, Recipe } from "@/components/macro/types";
import type {
  BloodPressure,
  BodyMeasurement,
  CustomFood,
  DailyLog,
  FastSession,
  FavoriteFood,
  FavoriteStore,
  MealSchedule,
  MealTemplate,
  PantryItem,
  PantryNotification,
  WaterIntake,
  WeightEntry,
} from "@/lib/db";
import { describe, expect, it } from "vitest";
import {
  bloodPressureFromRow,
  bloodPressureToRow,
  bodyMeasurementFromRow,
  bodyMeasurementToRow,
  customFoodFromRow,
  customFoodToRow,
  dailyLogFromRow,
  dailyLogToRow,
  fastSessionFromRow,
  fastSessionToRow,
  favoriteFoodFromRow,
  favoriteFoodToRow,
  favoriteStoreFromRow,
  favoriteStoreToRow,
  mealScheduleFromRow,
  mealScheduleToRow,
  mealTemplateFromRow,
  mealTemplateToRow,
  pantryItemFromRow,
  pantryItemToRow,
  pantryNotificationFromRow,
  pantryNotificationToRow,
  profileFromRow,
  profileToRow,
  recipeFromRow,
  recipeToRow,
  waterFromRow,
  waterToRow,
  weightFromRow,
  weightToRow,
} from "./mappers";

const USER = "11111111-1111-4111-8111-111111111111";

const PROFILE: PersonalInfo = {
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

describe("profile mappers", () => {
  it("round-trips profile → row → profile", () => {
    const row = profileToRow(USER, PROFILE);
    expect(row.user_id).toBe(USER);
    expect(row.payload).toEqual(PROFILE);
    // Adding the updated_at the DB would assign…
    const fullRow = { ...row, updated_at: "2026-05-13T10:00:00Z" };
    expect(profileFromRow(fullRow)).toEqual(PROFILE);
  });

  it("preserves cuisinePreferences and allergies through the JSONB blob", () => {
    // Regression cover for the new fields: profile rows are stored as
    // JSONB so adding fields shouldn't require schema changes - but it
    // also means it's silently easy to drop a field if a mapper ever
    // gets explicit. Pin the round-trip.
    const profile: PersonalInfo = {
      ...PROFILE,
      cuisinePreferences: ["Italian", "Japanese", "Korean"],
      allergies: ["peanuts", "shellfish"],
    };
    const row = profileToRow(USER, profile);
    const back = profileFromRow({ ...row, updated_at: "2026-05-13T10:00:00Z" });
    expect(back.cuisinePreferences).toEqual(["Italian", "Japanese", "Korean"]);
    expect(back.allergies).toEqual(["peanuts", "shellfish"]);
  });

  it("preserves displayName, dislikedFoods, and macroSplit through the JSONB blob", () => {
    // The JSONB-passthrough mapper makes adding fields cheap, but the
    // round-trip is the only thing pinning that contract. If anyone ever
    // converts profileToRow/profileFromRow into an explicit field-by-field
    // mapper, this test fails first.
    const profile: PersonalInfo = {
      ...PROFILE,
      displayName: "Alex",
      dislikedFoods: ["oats", "broccoli"],
      macroSplit: { protein: 40, carbs: 35, fat: 25 },
    };
    const row = profileToRow(USER, profile);
    const back = profileFromRow({ ...row, updated_at: "2026-05-13T10:00:00Z" });
    expect(back.displayName).toBe("Alex");
    expect(back.dislikedFoods).toEqual(["oats", "broccoli"]);
    expect(back.macroSplit).toEqual({ protein: 40, carbs: 35, fat: 25 });
  });
});

describe("daily log mappers", () => {
  const LOG: DailyLog = {
    date: "2026-05-13",
    meals: [
      { id: 1, name: "Breakfast", foods: [] },
      { id: 2, name: "Lunch", foods: [] },
    ],
    updatedAt: Date.parse("2026-05-13T10:00:00Z"),
  };

  it("toRow strips updated_at (DB assigns it)", () => {
    const row = dailyLogToRow(USER, LOG);
    expect(row).toEqual({
      user_id: USER,
      date: "2026-05-13",
      meals: LOG.meals,
    });
  });

  it("fromRow parses ISO updated_at into epoch ms", () => {
    const log = dailyLogFromRow({
      user_id: USER,
      date: "2026-05-13",
      meals: LOG.meals,
      updated_at: "2026-05-13T10:00:00.000Z",
    });
    expect(log).toEqual(LOG);
  });
});

describe("weight mappers", () => {
  const ENTRY: WeightEntry = {
    date: "2026-05-13",
    kg: 70.5,
    recordedAt: Date.parse("2026-05-13T08:30:00Z"),
  };

  it("round-trips weight entry", () => {
    const row = weightToRow(USER, ENTRY);
    expect(row.kg).toBe(70.5);
    expect(row.recorded_at).toBe("2026-05-13T08:30:00.000Z");
    const back = weightFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-13T08:30:00.000Z",
    });
    expect(back).toEqual(ENTRY);
  });
});

describe("water intake mappers", () => {
  const ENTRY: WaterIntake = {
    date: "2026-05-13",
    ml: 2350,
    recordedAt: Date.parse("2026-05-13T08:30:00Z"),
  };

  it("round-trips water intake", () => {
    const row = waterToRow(USER, ENTRY);
    expect(row.ml).toBe(2350);
    expect(row.recorded_at).toBe("2026-05-13T08:30:00.000Z");
    const back = waterFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-13T08:30:00.000Z",
    });
    expect(back).toEqual(ENTRY);
  });
});

describe("body measurement mappers", () => {
  const RECORDED_ISO = "2026-05-13T08:30:00.000Z";
  const FULL: BodyMeasurement = {
    date: "2026-05-13",
    waistCm: 82.5,
    neckCm: 38,
    hipsCm: 95,
    notes: "morning, fasted",
    recordedAt: Date.parse(RECORDED_ISO),
  };

  it("round-trips a fully-populated measurement", () => {
    const row = bodyMeasurementToRow(USER, FULL);
    expect(row.waist_cm).toBe(82.5);
    expect(row.neck_cm).toBe(38);
    expect(row.hips_cm).toBe(95);
    expect(row.notes).toBe("morning, fasted");
    expect(row.recorded_at).toBe(RECORDED_ISO);
    const back = bodyMeasurementFromRow({
      ...row,
      user_id: USER,
      updated_at: RECORDED_ISO,
    });
    expect(back).toEqual(FULL);
  });

  it("collapses missing optional fields to null on the wire", () => {
    // Partial measurement - only waist logged. Neck / hips / notes
    // must serialize as `null`, not the literal `undefined`, so the
    // Postgres column accepts the insert without an explicit DEFAULT.
    const partial: BodyMeasurement = {
      date: "2026-05-14",
      waistCm: 82,
      recordedAt: Date.parse(RECORDED_ISO),
    };
    const row = bodyMeasurementToRow(USER, partial);
    expect(row.waist_cm).toBe(82);
    expect(row.neck_cm).toBeNull();
    expect(row.hips_cm).toBeNull();
    expect(row.notes).toBeNull();
  });

  it("reads server nulls back as undefined (not null) on the client", () => {
    // The client-side BodyMeasurement type uses optional fields
    // (?) rather than nullable ones - the difference matters for
    // form-control binding and JSON serialization elsewhere in
    // the app.
    const back = bodyMeasurementFromRow({
      user_id: USER,
      date: "2026-05-14",
      waist_cm: 82,
      neck_cm: null,
      hips_cm: null,
      notes: null,
      recorded_at: RECORDED_ISO,
      updated_at: RECORDED_ISO,
    });
    expect(back.waistCm).toBe(82);
    expect(back.neckCm).toBeUndefined();
    expect(back.hipsCm).toBeUndefined();
    expect(back.notes).toBeUndefined();
  });
});

describe("blood pressure mappers", () => {
  const RECORDED_ISO = "2026-05-13T08:30:00.000Z";
  const FULL: BloodPressure = {
    date: "2026-05-13",
    systolic: 122,
    diastolic: 78,
    pulse: 64,
    notes: "resting, left arm",
    recordedAt: Date.parse(RECORDED_ISO),
  };

  it("round-trips a fully-populated reading", () => {
    const row = bloodPressureToRow(USER, FULL);
    expect(row.systolic).toBe(122);
    expect(row.diastolic).toBe(78);
    expect(row.pulse).toBe(64);
    expect(row.notes).toBe("resting, left arm");
    expect(row.recorded_at).toBe(RECORDED_ISO);
    const back = bloodPressureFromRow({
      ...row,
      user_id: USER,
      updated_at: RECORDED_ISO,
    });
    expect(back).toEqual(FULL);
  });

  it("collapses missing optional fields to null on the wire", () => {
    // Pulse + notes are optional; the required pressures always serialize.
    const minimal: BloodPressure = {
      date: "2026-05-14",
      systolic: 118,
      diastolic: 74,
      recordedAt: Date.parse(RECORDED_ISO),
    };
    const row = bloodPressureToRow(USER, minimal);
    expect(row.systolic).toBe(118);
    expect(row.diastolic).toBe(74);
    expect(row.pulse).toBeNull();
    expect(row.notes).toBeNull();
  });

  it("reads server nulls back as undefined on the client", () => {
    const back = bloodPressureFromRow({
      user_id: USER,
      date: "2026-05-14",
      systolic: 118,
      diastolic: 74,
      pulse: null,
      notes: null,
      recorded_at: RECORDED_ISO,
      updated_at: RECORDED_ISO,
    });
    expect(back.pulse).toBeUndefined();
    expect(back.notes).toBeUndefined();
  });
});

describe("fast session mappers", () => {
  const STARTED_ISO = "2026-05-13T20:00:00.000Z";
  const ENDED_ISO = "2026-05-14T12:00:00.000Z"; // a clean 16h fast
  const SESSION: FastSession = {
    id: "fast-abc",
    startedAt: Date.parse(STARTED_ISO),
    endedAt: Date.parse(ENDED_ISO),
    protocol: "16:8",
    targetHours: 16,
  };

  it("round-trips a fast session, ms <-> ISO instants", () => {
    const row = fastSessionToRow(USER, SESSION);
    expect(row.id).toBe("fast-abc");
    expect(row.started_at).toBe(STARTED_ISO);
    expect(row.ended_at).toBe(ENDED_ISO);
    expect(row.protocol).toBe("16:8");
    expect(row.target_hours).toBe(16);
    const back = fastSessionFromRow({
      ...row,
      user_id: USER,
      updated_at: ENDED_ISO,
    });
    expect(back).toEqual(SESSION);
  });

  it("carries a custom protocol's target across the wire", () => {
    const custom: FastSession = {
      ...SESSION,
      protocol: "custom",
      targetHours: 20,
    };
    const row = fastSessionToRow(USER, custom);
    expect(row.protocol).toBe("custom");
    expect(row.target_hours).toBe(20);
    const back = fastSessionFromRow({
      ...row,
      user_id: USER,
      updated_at: ENDED_ISO,
    });
    expect(back.protocol).toBe("custom");
    expect(back.targetHours).toBe(20);
  });
});

describe("custom food mappers", () => {
  const FOOD: CustomFood = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Whey",
    protein: 80,
    carbs: 8,
    fat: 2,
    calories: 370,
    brand: "MyBrand",
    createdAt: Date.parse("2026-05-13T08:00:00Z"),
  };

  it("maps optional brand and category to null on the row side", () => {
    const minimal: CustomFood = {
      id: FOOD.id,
      name: "Minimal",
      protein: 1,
      carbs: 1,
      fat: 1,
      calories: 17,
      createdAt: Date.now(),
    };
    const row = customFoodToRow(USER, minimal);
    expect(row.brand).toBeNull();
    expect(row.category).toBeNull();
    expect(row.sub_category).toBeNull();
  });

  it("round-trips through the row shape", () => {
    const row = customFoodToRow(USER, FOOD);
    const back = customFoodFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-13T08:00:00.000Z",
    });
    expect(back).toEqual(FOOD);
  });

  it("fromRow restores undefined for null brand/category/dietKind", () => {
    const back = customFoodFromRow({
      id: FOOD.id,
      user_id: USER,
      name: "x",
      protein: 0,
      carbs: 0,
      fat: 0,
      calories: 0,
      brand: null,
      category: null,
      sub_category: null,
      diet_kind: null,
      created_at: "2026-05-13T08:00:00.000Z",
      updated_at: "2026-05-13T08:00:00.000Z",
    });
    expect(back.brand).toBeUndefined();
    expect(back.category).toBeUndefined();
    expect(back.subCategory).toBeUndefined();
    expect(back.dietKind).toBeUndefined();
  });

  it("fromRow round-trips a valid dietKind value", () => {
    const back = customFoodFromRow({
      id: FOOD.id,
      user_id: USER,
      name: "Tofu",
      protein: 8,
      carbs: 2,
      fat: 4,
      calories: 76,
      brand: null,
      category: null,
      sub_category: null,
      diet_kind: "plant",
      created_at: "2026-05-13T08:00:00.000Z",
      updated_at: "2026-05-13T08:00:00.000Z",
    });
    expect(back.dietKind).toBe("plant");
  });

  it("fromRow rejects unknown dietKind strings (treat as unclassified)", () => {
    const back = customFoodFromRow({
      id: FOOD.id,
      user_id: USER,
      name: "x",
      protein: 0,
      carbs: 0,
      fat: 0,
      calories: 0,
      brand: null,
      category: null,
      sub_category: null,
      diet_kind: "not-a-real-kind",
      created_at: "2026-05-13T08:00:00.000Z",
      updated_at: "2026-05-13T08:00:00.000Z",
    });
    expect(back.dietKind).toBeUndefined();
  });
});

describe("meal template mappers", () => {
  const TEMPLATE: MealTemplate = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Greek yogurt bowl",
    foods: [
      {
        id: 1,
        name: "Yogurt",
        protein: 10,
        carbs: 4,
        fat: 0,
        calories: 60,
        portionSize: 100,
      },
    ],
    createdAt: Date.parse("2026-05-13T08:00:00Z"),
    updatedAt: Date.parse("2026-05-13T09:00:00Z"),
  };

  it("round-trips template", () => {
    const row = mealTemplateToRow(USER, TEMPLATE);
    const back = mealTemplateFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-13T09:00:00.000Z",
    });
    expect(back).toEqual(TEMPLATE);
  });
});

describe("recipe mappers", () => {
  const RECIPE: Recipe = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Oats bowl",
    ingredients: [
      {
        foodName: "Oats",
        macrosPer100g: { protein: 13, carbs: 67, fat: 7, calories: 389 },
        portionGrams: 80,
        dietKind: "plant",
      },
      {
        foodName: "Almond butter",
        macrosPer100g: { protein: 21, carbs: 19, fat: 56, calories: 614 },
        portionGrams: 20,
        dietKind: "plant",
        // Per-100g micronutrients ride inside the ingredients JSONB,
        // so they must survive the recipe round-trip unchanged.
        micronutrientsPer100g: { magnesium: 270, calcium: 350, iron: 3.5 },
      },
    ],
    cuisine: "American",
    notes: "Soak overnight.",
    sourceUrl: "https://example.com/oats-bowl",
    servings: 2,
    prepTimeMinutes: 5,
    createdAt: Date.parse("2026-05-13T08:00:00Z"),
    updatedAt: Date.parse("2026-05-13T09:00:00Z"),
  };

  it("round-trips recipe with all optional fields populated", () => {
    const row = recipeToRow(USER, RECIPE);
    const back = recipeFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-13T09:00:00.000Z",
    });
    expect(back).toEqual(RECIPE);
  });

  it("translates undefined cuisine/notes into nullable columns", () => {
    const slim: Recipe = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Slim",
      ingredients: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const row = recipeToRow(USER, slim);
    expect(row.cuisine).toBeNull();
    expect(row.notes).toBeNull();
    const back = recipeFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(back.cuisine).toBeUndefined();
    expect(back.notes).toBeUndefined();
    // The migration-0039 fields should also nullify when unset, and
    // come back as undefined on the round trip so an existing
    // recipe that pre-dates these fields stays clean.
    expect(row.source_url).toBeNull();
    expect(row.servings).toBeNull();
    expect(row.prep_time_minutes).toBeNull();
    expect(back.sourceUrl).toBeUndefined();
    expect(back.servings).toBeUndefined();
    expect(back.prepTimeMinutes).toBeUndefined();
  });
});

describe("pantry item mappers", () => {
  const ITEM: PantryItem = {
    id: "66666666-6666-4666-8666-666666666666",
    name: "Eggs",
    quantity: 12,
    unit: "eggs",
    note: "free-range",
    category: "Dairy & Eggs",
    density: 1.03,
    lowThreshold: 2,
    createdAt: Date.parse("2026-05-20T08:00:00Z"),
    updatedAt: Date.parse("2026-05-20T09:00:00Z"),
  };

  it("round-trips a pantry item with all fields populated", () => {
    const row = pantryItemToRow(USER, ITEM);
    expect(row.user_id).toBe(USER);
    expect(row.category).toBe("Dairy & Eggs");
    expect(row.density).toBe(1.03);
    expect(row.low_threshold).toBe(2);
    const back = pantryItemFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-20T09:00:00.000Z",
    });
    expect(back).toEqual(ITEM);
  });

  it("translates an undefined note + category into nullable columns and back", () => {
    const slim: PantryItem = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Rice",
      quantity: 0,
      unit: "g",
      createdAt: 0,
      updatedAt: 0,
    };
    const row = pantryItemToRow(USER, slim);
    expect(row.note).toBeNull();
    expect(row.category).toBeNull();
    expect(row.density).toBeNull();
    expect(row.low_threshold).toBeNull();
    // quantity 0 must survive the round trip (it's a legitimate value,
    // not "missing") — guards against a truthiness bug.
    expect(row.quantity).toBe(0);
    const back = pantryItemFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(back.note).toBeUndefined();
    expect(back.category).toBeUndefined();
    expect(back.density).toBeUndefined();
    expect(back.lowThreshold).toBeUndefined();
    expect(back.quantity).toBe(0);
  });
});

describe("pantry notification mappers", () => {
  const NOTIF: PantryNotification = {
    id: "88888888-8888-4888-8888-888888888888",
    type: "low-stock",
    itemId: "66666666-6666-4666-8666-666666666666",
    itemName: "Eggs",
    quantity: 1,
    unit: "eggs",
    read: false,
    createdAt: Date.parse("2026-05-20T08:00:00Z"),
    updatedAt: Date.parse("2026-05-20T09:00:00Z"),
  };

  it("round-trips a low-stock notification (camelCase ↔ snake_case)", () => {
    const row = pantryNotificationToRow(USER, NOTIF);
    expect(row.user_id).toBe(USER);
    expect(row.item_id).toBe(NOTIF.itemId);
    expect(row.item_name).toBe(NOTIF.itemName);
    const back = pantryNotificationFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-20T09:00:00.000Z",
    });
    expect(back).toEqual(NOTIF);
  });
});

describe("favourite store mappers", () => {
  const STORE: FavoriteStore = {
    id: "node/123",
    name: "Lidl",
    kind: "supermarket",
    lat: 52.36,
    lon: 4.87,
    address: "186 Market Street, Amsterdam",
    createdAt: Date.parse("2026-05-20T08:00:00Z"),
    updatedAt: Date.parse("2026-05-20T09:00:00Z"),
  };

  it("round-trips a favourite store (OSM id key)", () => {
    const row = favoriteStoreToRow(USER, STORE);
    expect(row.id).toBe("node/123");
    expect(row.user_id).toBe(USER);
    const back = favoriteStoreFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-20T09:00:00.000Z",
    });
    expect(back).toEqual(STORE);
  });

  it("translates an undefined address into a nullable column and back", () => {
    const slim: FavoriteStore = {
      id: "way/9",
      name: "Corner Shop",
      kind: "convenience",
      lat: 0,
      lon: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const row = favoriteStoreToRow(USER, slim);
    expect(row.address).toBeNull();
    const back = favoriteStoreFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(back.address).toBeUndefined();
  });
});

describe("favourite food mappers", () => {
  const FAV: FavoriteFood = {
    id: "ffff1111-1111-4111-8111-111111111111",
    nameKey: "chicken breast",
    food: {
      name: "Chicken Breast",
      protein: 31,
      carbs: 0,
      fat: 3.6,
      calories: 165,
      micronutrients: { sodium: 74 },
    },
    portion: 150,
    createdAt: Date.parse("2026-05-20T08:00:00Z"),
  };

  it("round-trips a favourite food (food in a JSONB column)", () => {
    const row = favoriteFoodToRow(USER, FAV);
    expect(row.id).toBe(FAV.id);
    expect(row.user_id).toBe(USER);
    expect(row.name_key).toBe("chicken breast");
    expect(row.food).toEqual(FAV.food);
    expect(row.portion).toBe(150);
    const back = favoriteFoodFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-20T09:00:00.000Z",
    });
    expect(back).toEqual(FAV);
  });
});

describe("meal schedule mappers", () => {
  const SCHEDULE: MealSchedule = {
    id: "66666666-6666-4666-8666-666666666666",
    recipeId: "44444444-4444-4444-8444-444444444444",
    recipeName: "Oats bowl",
    mealNames: ["breakfast", "lunch"],
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    daysOfWeek: [1, 2, 3, 4, 5],
    scale: 2,
    sortOrder: 3,
    createdAt: Date.parse("2026-05-13T08:00:00Z"),
    updatedAt: Date.parse("2026-05-13T09:00:00Z"),
  };

  it("round-trips a meal schedule unchanged", () => {
    const row = mealScheduleToRow(USER, SCHEDULE);
    const back = mealScheduleFromRow({
      ...row,
      user_id: USER,
      updated_at: "2026-05-13T09:00:00.000Z",
    });
    expect(back).toEqual(SCHEDULE);
  });

  it("snapshots the recipe name + carries the jsonb arrays", () => {
    const row = mealScheduleToRow(USER, SCHEDULE);
    expect(row.name).toBe("Oats bowl");
    expect(row.recipe_id).toBe(SCHEDULE.recipeId);
    expect(row.meal_names).toEqual(["breakfast", "lunch"]);
    expect(row.days_of_week).toEqual([1, 2, 3, 4, 5]);
  });
});
