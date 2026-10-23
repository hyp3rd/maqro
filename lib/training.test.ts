import { describe, expect, it } from "vitest";
import {
  CYCLING_WEIGHTS,
  type DayMacroInput,
  type TrainingDayClass,
  classifyTrainingDay,
  distributeWeekCalories,
  normalizeProteinSetting,
  normalizeTrainingSchedule,
  partitionDayMacros,
  proteinCeilingGrams,
  proteinGrams,
  referenceWeightKg,
  weekProteinGrams,
} from "@maqro/core/training";
import type {
  CyclingPreset,
  TrainingDay,
  TrainingWeek,
} from "@maqro/core/types";

/** The mockup week, indexed by `getDay()` (0 = Sunday): Mon upper moderate,
 *  Tue rest, Wed lower hard, Thu rest, Fri full body moderate, Sat long
 *  endurance, Sun rest. */
const MOCKUP_WEEK: TrainingWeek = [
  { type: "rest" },
  { type: "upper", intensity: "moderate", time: "18:00", durationMin: 60 },
  { type: "rest" },
  { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
  { type: "rest" },
  { type: "fullBody", intensity: "moderate", time: "07:00", durationMin: 60 },
  { type: "endurance", intensity: "moderate", time: "09:00", durationMin: 90 },
];
const MOCKUP_CLASSES: TrainingDayClass[] = [
  "rest",
  "training",
  "rest",
  "heavy",
  "rest",
  "training",
  "endurance",
];

describe("classifyTrainingDay", () => {
  const rows: [string, TrainingDay, TrainingDayClass][] = [
    ["rest", { type: "rest" }, "rest"],
    ["rest ignores intensity", { type: "rest", intensity: "hard" }, "rest"],
    ["upper, unspecified", { type: "upper" }, "training"],
    ["upper light", { type: "upper", intensity: "light" }, "light"],
    ["upper moderate", { type: "upper", intensity: "moderate" }, "training"],
    ["upper hard", { type: "upper", intensity: "hard" }, "heavy"],
    ["lower, unspecified → heavy by default", { type: "lower" }, "heavy"],
    ["lower moderate", { type: "lower", intensity: "moderate" }, "training"],
    ["lower light", { type: "lower", intensity: "light" }, "light"],
    ["lower hard", { type: "lower", intensity: "hard" }, "heavy"],
    ["full body, unspecified", { type: "fullBody" }, "training"],
    ["full body hard", { type: "fullBody", intensity: "hard" }, "heavy"],
    ["hiit, unspecified", { type: "hiit" }, "training"],
    ["hiit hard", { type: "hiit", intensity: "hard" }, "heavy"],
    ["sport light", { type: "sport", intensity: "light" }, "light"],
    ["sport moderate", { type: "sport", intensity: "moderate" }, "training"],
    ["endurance, no duration", { type: "endurance" }, "training"],
    ["endurance 60 min", { type: "endurance", durationMin: 60 }, "training"],
    ["endurance 61 min", { type: "endurance", durationMin: 61 }, "endurance"],
    [
      "long endurance, hard",
      { type: "endurance", intensity: "hard", durationMin: 90 },
      "endurance",
    ],
    [
      "long endurance, light → still at least heavy",
      { type: "endurance", intensity: "light", durationMin: 75 },
      "endurance",
    ],
    [
      "very long endurance, light → still at least heavy",
      { type: "endurance", intensity: "light", durationMin: 120 },
      "endurance",
    ],
    [
      "short endurance, light keeps its intensity class",
      { type: "endurance", intensity: "light", durationMin: 45 },
      "light",
    ],
    [
      "short endurance, hard",
      { type: "endurance", intensity: "hard", durationMin: 40 },
      "heavy",
    ],
    [
      "a long non-endurance session is not 'endurance'",
      { type: "upper", intensity: "moderate", durationMin: 120 },
      "training",
    ],
    [
      "light 90 min keeps its intensity class",
      { type: "upper", intensity: "light", durationMin: 90 },
      "light",
    ],
    [
      "light over 90 min is never light → training",
      { type: "sport", intensity: "light", durationMin: 91 },
      "training",
    ],
    [
      "hard over 90 min stays heavy",
      { type: "fullBody", intensity: "hard", durationMin: 120 },
      "heavy",
    ],
    [
      "lower, unspecified, over 90 min stays heavy",
      { type: "lower", durationMin: 120 },
      "heavy",
    ],
    [
      "rest is rest whatever the duration",
      { type: "rest", durationMin: 120 },
      "rest",
    ],
  ];
  for (const [name, day, cls] of rows) {
    it(name, () => {
      expect(classifyTrainingDay(day)).toBe(cls);
    });
  }

  it("classifies the mockup week", () => {
    expect(MOCKUP_WEEK.map(classifyTrainingDay)).toEqual(MOCKUP_CLASSES);
  });

  it("a long endurance day weighs at least as much as a heavy day", () => {
    for (const preset of ["modest", "pronounced"] as const) {
      const w = CYCLING_WEIGHTS[preset];
      expect(w.endurance).toBeGreaterThanOrEqual(w.heavy);
      expect(w.heavy).toBeGreaterThan(w.training);
      expect(w.training).toBeGreaterThan(w.light);
      expect(w.light).toBeGreaterThan(w.rest);
    }
  });
});

describe("normalizeTrainingSchedule", () => {
  it("round-trips a valid schedule", () => {
    const raw = { enabled: true, days: MOCKUP_WEEK, cycling: "pronounced" };
    expect(normalizeTrainingSchedule(raw)).toEqual(raw);
  });

  for (const raw of [undefined, null, "yes", 42, true, [], {}]) {
    it(`a non-schedule payload (${JSON.stringify(raw)}) → null`, () => {
      expect(normalizeTrainingSchedule(raw)).toBeNull();
    });
  }

  for (const days of [
    undefined,
    "mon",
    {},
    MOCKUP_WEEK.slice(0, 6),
    [...MOCKUP_WEEK, { type: "rest" }],
  ]) {
    it(`days that aren't 7 entries (${JSON.stringify(days)?.slice(0, 20)}) → null`, () => {
      expect(
        normalizeTrainingSchedule({ enabled: true, days, cycling: "modest" }),
      ).toBeNull();
    });
  }

  it("only a literal true enables it", () => {
    for (const enabled of ["true", 1, null, undefined]) {
      expect(
        normalizeTrainingSchedule({ enabled, days: MOCKUP_WEEK })?.enabled,
      ).toBe(false);
    }
  });

  it("an unknown or missing cycling preset → modest (the default)", () => {
    for (const cycling of ["aggressive", 2, null, undefined]) {
      expect(
        normalizeTrainingSchedule({ enabled: true, days: MOCKUP_WEEK, cycling })
          ?.cycling,
      ).toBe("modest");
    }
  });

  it("a malformed day becomes rest; malformed optional fields are dropped", () => {
    const days = [
      { type: "yoga", intensity: "hard" },
      null,
      "upper",
      { type: "upper", intensity: "extreme", time: "7:00", durationMin: NaN },
      { type: "lower", time: "24:00", durationMin: -5 },
      { type: "fullBody", time: "18:60", durationMin: "60" },
      {
        type: "endurance",
        intensity: "light",
        time: "06:30",
        durationMin: 75,
        extra: "stripped",
      },
    ];
    expect(normalizeTrainingSchedule({ enabled: true, days })?.days).toEqual([
      { type: "rest" },
      { type: "rest" },
      { type: "rest" },
      { type: "upper" },
      { type: "lower" },
      { type: "fullBody" },
      { type: "endurance", intensity: "light", time: "06:30", durationMin: 75 },
    ]);
  });

  it("drops a zero or longer-than-a-day duration", () => {
    const days = MOCKUP_WEEK.map((d, i) =>
      i === 6
        ? { ...d, durationMin: 1441 }
        : i === 1
          ? { ...d, durationMin: 0 }
          : d,
    );
    const out = normalizeTrainingSchedule({ enabled: true, days });
    expect(out?.days[6].durationMin).toBeUndefined();
    expect(out?.days[1].durationMin).toBeUndefined();
  });

  it("never mutates the stored payload", () => {
    const raw = Object.freeze({
      enabled: true,
      days: Object.freeze([
        Object.freeze({ type: "yoga" }),
        ...MOCKUP_WEEK.slice(1),
      ]),
      cycling: "nope",
    });
    const before = JSON.stringify(raw);
    normalizeTrainingSchedule(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("normalizeProteinSetting", () => {
  it("absent → 2.0 g/kg bodyweight", () => {
    expect(normalizeProteinSetting(undefined)).toEqual({
      basis: "bodyweight",
      gPerKg: 2,
    });
  });

  it("keeps a valid lean-mass setting", () => {
    expect(normalizeProteinSetting({ basis: "leanMass", gPerKg: 2.6 })).toEqual(
      { basis: "leanMass", gPerKg: 2.6 },
    );
  });

  it("an unknown basis → bodyweight; a non-number g/kg → the default", () => {
    expect(normalizeProteinSetting({ basis: "ffm", gPerKg: "2.4" })).toEqual({
      basis: "bodyweight",
      gPerKg: 2,
    });
    expect(normalizeProteinSetting({ basis: "leanMass", gPerKg: NaN })).toEqual(
      { basis: "leanMass", gPerKg: 2 },
    );
    expect(normalizeProteinSetting("x")).toEqual({
      basis: "bodyweight",
      gPerKg: 2,
    });
  });

  it("clamps g/kg into the safe range per basis", () => {
    expect(normalizeProteinSetting({ gPerKg: 0.5 }).gPerKg).toBe(1.2);
    expect(normalizeProteinSetting({ gPerKg: 5 }).gPerKg).toBe(3.4);
    expect(
      normalizeProteinSetting({ basis: "leanMass", gPerKg: 5 }).gPerKg,
    ).toBe(3.1);
  });
});

describe("proteinGrams", () => {
  /** 80 kg / 180 cm: BMI 24.7. */
  const lean = { weightKg: 80, heightCm: 180 };
  /** 120 kg / 180 cm: BMI 37; the BMI-25 weight for 180 cm is 81 kg. */
  const obese = { weightKg: 120, heightCm: 180 };

  it("bodyweight basis: g/kg × weight", () => {
    expect(proteinGrams({ basis: "bodyweight", gPerKg: 2 }, lean)).toEqual({
      grams: 160,
      basis: "bodyweight",
      kg: 80,
    });
  });

  it("lean-mass basis uses weight × (1 − body fat)", () => {
    const out = proteinGrams(
      { basis: "leanMass", gPerKg: 2.6 },
      { ...lean, bodyFatPct: 20 },
    );
    expect(out.basis).toBe("leanMass");
    expect(out.grams).toBeCloseTo(166.4, 9);
    // The 1.2 g/kg minimum stays a bodyweight figure.
    expect(out.kg).toBe(80);
  });

  it("lean mass without a usable estimate → the 2.0 g/kg bodyweight default", () => {
    // Not the lean-mass 2.6 g/kg applied to bodyweight (208 g): a lean-mass
    // figure is per kg of FFM and over-prescribes on total weight.
    for (const bf of [undefined, null, NaN, 2, 70]) {
      expect(
        proteinGrams(
          { basis: "leanMass", gPerKg: 2.6 },
          { ...lean, bodyFatPct: bf },
        ),
      ).toEqual({ grams: 160, basis: "bodyweight", kg: 80 });
    }
  });

  it("a bodyweight setting keeps its own g/kg", () => {
    expect(proteinGrams({ basis: "bodyweight", gPerKg: 2.6 }, lean)).toEqual({
      grams: 208,
      basis: "bodyweight",
      kg: 80,
    });
  });

  describe("BMI ≥ 30 without a body-fat estimate → the BMI-25 weight", () => {
    const rows: [string, Parameters<typeof proteinGrams>, number, string][] = [
      [
        "bodyweight 2.0 at 180 cm / 120 kg → 2.0 × 81",
        [{ basis: "bodyweight", gPerKg: 2 }, obese],
        162,
        "referenceWeight",
      ],
      [
        "bodyweight 1.6 at 180 cm / 120 kg → 1.6 × 81",
        [{ basis: "bodyweight", gPerKg: 1.6 }, obese],
        129.6,
        "referenceWeight",
      ],
      [
        "lean mass, no estimate: the 2.0 default on 81 kg",
        [{ basis: "leanMass", gPerKg: 2.6 }, obese],
        162,
        "referenceWeight",
      ],
      [
        "BMI exactly 30 (200 cm / 120 kg) → 2.0 × 100",
        [
          { basis: "bodyweight", gPerKg: 2 },
          { weightKg: 120, heightCm: 200 },
        ],
        200,
        "referenceWeight",
      ],
      [
        "BMI just under 30 (200 cm / 119.9 kg) → bodyweight",
        [
          { basis: "bodyweight", gPerKg: 2 },
          { weightKg: 119.9, heightCm: 200 },
        ],
        239.8,
        "bodyweight",
      ],
      [
        "with an estimate, a bodyweight setting applies as set",
        [
          { basis: "bodyweight", gPerKg: 2 },
          { ...obese, bodyFatPct: 35 },
        ],
        240,
        "bodyweight",
      ],
      [
        "with an estimate, lean mass applies (2.6 × 78 kg)",
        [
          { basis: "leanMass", gPerKg: 2.6 },
          { ...obese, bodyFatPct: 35 },
        ],
        202.8,
        "leanMass",
      ],
      [
        "an implausible estimate counts as none",
        [
          { basis: "bodyweight", gPerKg: 2 },
          { ...obese, bodyFatPct: 75 },
        ],
        162,
        "referenceWeight",
      ],
    ];
    for (const [name, args, grams, basis] of rows) {
      it(name, () => {
        const out = proteinGrams(...args);
        expect(out.grams).toBeCloseTo(grams, 9);
        expect(out.basis).toBe(basis);
        expect(out.kg).toBeCloseTo(
          basis === "referenceWeight"
            ? 25 * (args[1].heightCm / 100) ** 2
            : args[1].weightKg,
          9,
        );
      });
    }

    it("a height that isn't a positive number → bodyweight", () => {
      for (const heightCm of [0, -180, NaN, Infinity]) {
        expect(
          proteinGrams(
            { basis: "bodyweight", gPerKg: 2 },
            { weightKg: 120, heightCm },
          ),
        ).toEqual({ grams: 240, basis: "bodyweight", kg: 120 });
      }
    });
  });
});

describe("referenceWeightKg", () => {
  it("is the BMI-25 weight for the height", () => {
    expect(referenceWeightKg(180)).toBeCloseTo(81, 9);
    expect(referenceWeightKg(160)).toBeCloseTo(64, 9);
    expect(referenceWeightKg(0)).toBeNull();
    expect(referenceWeightKg(NaN)).toBeNull();
  });
});

describe("distributeWeekCalories", () => {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  it("the mockup week (mean 2,200, floor 1,780, modest) keeps 7 × 2,200", () => {
    const days = distributeWeekCalories({
      meanKcal: 2200,
      classes: MOCKUP_CLASSES,
      cycling: "modest",
      floorKcal: 1780,
    });
    // Sun Mon Tue Wed Thu Fri Sat. The long endurance Saturday weighs as
    // much as the heavy Wednesday. Naive per-day rounding gives 15,450; the
    // largest remainder leaves the extra 50 off the later training day (Fri).
    expect(days).toEqual([1950, 2300, 1950, 2500, 1950, 2250, 2500]);
    expect(sum(days)).toBe(15400);
  });

  it("cycling off keeps every day at the mean, unrounded", () => {
    expect(
      distributeWeekCalories({
        meanKcal: 2213,
        classes: MOCKUP_CLASSES,
        cycling: "off",
        floorKcal: 1780,
      }),
    ).toEqual(Array(7).fill(2213));
  });

  it("a uniform template has no spread, so every day stays at the mean", () => {
    expect(
      distributeWeekCalories({
        meanKcal: 2213,
        classes: Array(7).fill("training"),
        cycling: "pronounced",
        floorKcal: 1780,
      }),
    ).toEqual(Array(7).fill(2213));
  });

  describe("rounding guarantee: 50 kcal steps, week within 25 of 7 × mean", () => {
    const templates: TrainingDayClass[][] = [
      MOCKUP_CLASSES,
      ["heavy", "rest", "rest", "rest", "rest", "rest", "rest"],
      ["rest", "heavy", "heavy", "heavy", "heavy", "heavy", "heavy"],
      ["light", "training", "rest", "endurance", "light", "heavy", "rest"],
    ];
    const presets: CyclingPreset[] = ["modest", "pronounced"];
    for (const mean of [1999, 2200, 2210, 2537, 3013]) {
      for (const cycling of presets) {
        templates.forEach((classes, t) => {
          it(`mean ${mean}, ${cycling}, template ${t}`, () => {
            const days = distributeWeekCalories({
              meanKcal: mean,
              classes,
              cycling,
              floorKcal: 1500,
            });
            for (const d of days) expect(d % 50).toBe(0);
            const diff = sum(days) - 7 * mean;
            expect(Math.abs(diff)).toBeLessThanOrEqual(25);
            if ((7 * mean) % 50 === 0) expect(diff).toBe(0);
          });
        });
      }
    }
  });

  it("clamps the high side to 1.25 × mean by narrowing the spread", () => {
    // Pronounced, one heavy day among six rest days: unclamped the heavy day
    // would be ~1.45 × mean.
    const days = distributeWeekCalories({
      meanKcal: 2000,
      classes: ["heavy", "rest", "rest", "rest", "rest", "rest", "rest"],
      cycling: "pronounced",
      floorKcal: 1200,
    });
    expect(days).toEqual([2500, 1950, 1950, 1900, 1900, 1900, 1900]);
    expect(sum(days)).toBe(14000);
  });

  it("clamps the low side to 0.80 × mean", () => {
    const days = distributeWeekCalories({
      meanKcal: 3000,
      classes: ["heavy", "heavy", "heavy", "heavy", "heavy", "heavy", "rest"],
      cycling: "pronounced",
      floorKcal: 1500,
    });
    expect(days).toEqual([3100, 3100, 3100, 3100, 3100, 3100, 2400]);
  });

  it("narrows the spread rather than going under the safety floor", () => {
    // Unconstrained, the rest days would be ~1,787 — under the 1,900 floor.
    const days = distributeWeekCalories({
      meanKcal: 2000,
      classes: MOCKUP_CLASSES,
      cycling: "modest",
      floorKcal: 1900,
    });
    expect(days).toEqual([1900, 2050, 1900, 2100, 1900, 2050, 2100]);
    expect(Math.min(...days)).toBeGreaterThanOrEqual(1900);
    expect(sum(days)).toBe(14000);
  });

  it("collapses to the mean when the floor leaves no room to cycle", () => {
    // The first 50-step at or above the 1,780 floor (1,800) is above the
    // 1,790 mean, so no day can go lower without breaching the floor.
    expect(
      distributeWeekCalories({
        meanKcal: 1790,
        classes: MOCKUP_CLASSES,
        cycling: "pronounced",
        floorKcal: 1780,
      }),
    ).toEqual(Array(7).fill(1790));
  });

  it("never plans a day under 800 kcal, whatever floor is passed", () => {
    const days = distributeWeekCalories({
      meanKcal: 900,
      classes: MOCKUP_CLASSES,
      cycling: "pronounced",
      floorKcal: 0,
    });
    expect(Math.min(...days)).toBeGreaterThanOrEqual(800);
  });
});

describe("partitionDayMacros", () => {
  /** The mockup's mean day: 2,200 kcal on a cut — computeMacros' 40/25/35
   *  split gives 138 g carbs and 86 g fat. 80 kg, 160 g protein. */
  function input(over: Partial<DayMacroInput> = {}): DayMacroInput {
    return {
      dayKcal: 2200,
      dayClass: "training",
      mean: { targetCalories: 2200, carbs: 138, fat: 86 },
      proteinGrams: 160,
      weightKg: 80,
      proteinKg: over.weightKg ?? 80,
      goal: "lose",
      dietType: "balanced",
      ...over,
    };
  }
  const kcal = (m: { protein: number; carbs: number; fat: number }) =>
    4 * m.protein + 4 * m.carbs + 9 * m.fat;

  it("protein and fat stay put; carbs absorb the day's difference", () => {
    const rest = partitionDayMacros(input({ dayKcal: 1950, dayClass: "rest" }));
    const heavy = partitionDayMacros(
      input({ dayKcal: 2500, dayClass: "heavy" }),
    );
    expect(rest).toEqual({ protein: 160, carbs: 135, fat: 85 });
    expect(heavy).toEqual({ protein: 160, carbs: 275, fat: 85 });
  });

  it("rounds every macro to 5 g", () => {
    const m = partitionDayMacros(input({ proteinGrams: 166.4, dayKcal: 2350 }));
    for (const g of [m.protein, m.carbs, m.fat]) expect(g % 5).toBe(0);
    expect(m.protein).toBe(165);
  });

  it("raises fat to 20% of the mean kcal outside a cut", () => {
    // A 10%-fat split would leave 24 g; 20% of 2,200 kcal is 48.9 g.
    const m = partitionDayMacros(
      input({
        goal: "maintain",
        mean: { targetCalories: 2200, carbs: 300, fat: 24 },
      }),
    );
    expect(m.fat).toBe(50);
  });

  it("allows 15% in a cut, but never under 0.5 g/kg", () => {
    // 15% of 2,200 = 36.7 g; 0.5 g/kg × 80 kg = 40 g wins.
    const m = partitionDayMacros(
      input({
        goal: "lose",
        mean: { targetCalories: 2200, carbs: 300, fat: 24 },
      }),
    );
    expect(m.fat).toBe(40);
  });

  it("the 0.5 g/kg fat floor scales with bodyweight", () => {
    const m = partitionDayMacros(
      input({
        goal: "maintain",
        weightKg: 120,
        proteinGrams: 240,
        mean: { targetCalories: 2200, carbs: 300, fat: 24 },
        dayKcal: 2600,
      }),
    );
    expect(m.fat).toBe(60);
  });

  it("rest days keep at least 1 g/kg carbs by trading fat down", () => {
    const m = partitionDayMacros(
      input({
        goal: "maintain",
        dayKcal: 1800,
        dayClass: "rest",
        mean: { targetCalories: 2200, carbs: 110, fat: 120 },
      }),
    );
    expect(m.carbs).toBeGreaterThanOrEqual(80);
    expect(m.fat).toBeLessThan(120);
    expect(m.fat).toBeGreaterThanOrEqual(48.9);
    expect(m.protein).toBe(160);
  });

  it("heavy days aim for 3 g/kg carbs when the budget allows", () => {
    expect(
      partitionDayMacros(
        input({
          goal: "maintain",
          dayKcal: 2500,
          dayClass: "heavy",
          mean: { targetCalories: 2200, carbs: 110, fat: 120 },
        }),
      ),
    ).toEqual({ protein: 160, carbs: 240, fat: 100 });
  });

  it("…and stop at the fat floor when it doesn't", () => {
    const m = partitionDayMacros(
      input({ goal: "maintain", dayKcal: 2000, dayClass: "heavy" }),
    );
    expect(m.fat).toBe(50);
    expect(m.carbs).toBe(230);
  });

  it("low-carb: carbs hold at the weekly level and fat moves instead", () => {
    const mean = { targetCalories: 2200, carbs: 110, fat: 110 };
    const rest = partitionDayMacros(
      input({ dietType: "lowCarb", mean, dayKcal: 1950, dayClass: "rest" }),
    );
    const heavy = partitionDayMacros(
      input({ dietType: "lowCarb", mean, dayKcal: 2500, dayClass: "heavy" }),
    );
    expect(rest).toEqual({ protein: 160, carbs: 110, fat: 95 });
    expect(heavy).toEqual({ protein: 160, carbs: 110, fat: 160 });
  });

  it("low-carb: fat keeps its floor, carbs give way", () => {
    const m = partitionDayMacros(
      input({
        goal: "maintain",
        dietType: "lowCarb",
        mean: { targetCalories: 2200, carbs: 110, fat: 110 },
        dayKcal: 1400,
        dayClass: "rest",
      }),
    );
    expect(m.fat).toBeGreaterThanOrEqual(48.9);
    expect(m.carbs).toBeLessThan(110);
    expect(m.protein).toBe(160);
  });

  it("stays energy-consistent with the day's kcal", () => {
    for (const dietType of ["balanced", "lowCarb", "lowFat"] as const) {
      for (const dayClass of ["rest", "light", "training", "heavy"] as const) {
        for (let dayKcal = 1800; dayKcal <= 2750; dayKcal += 50) {
          const m = partitionDayMacros(input({ dietType, dayClass, dayKcal }));
          expect(Math.abs(kcal(m) - dayKcal)).toBeLessThanOrEqual(45);
        }
      }
    }
  });

  it("protein gives way so the fat and carb floors hold", () => {
    // 120 kg on a cut at the 2,150 BMR floor, protein set to 3.4 g/kg
    // (408 g): fat floor 60 g (0.5 g/kg), carb floor 120 g (1 g/kg).
    const m = partitionDayMacros(
      input({
        dayKcal: 2150,
        dayClass: "rest",
        mean: { targetCalories: 2150, carbs: 135, fat: 70 },
        proteinGrams: 408,
        weightKg: 120,
      }),
    );
    expect(m.fat).toBeGreaterThanOrEqual(60);
    expect(m.carbs).toBeGreaterThanOrEqual(120);
    expect(m.protein).toBe(280); // (2,150 − 9·60 − 4·120) / 4 = 282 → 280
    expect(Math.abs(kcal(m) - 2150)).toBeLessThanOrEqual(45);
  });

  it("protein keeps 1.2 g/kg ahead of the carb floor, never ahead of fat", () => {
    // 200 kg on a 2,400 day: fat floor 100 g leaves 1,500 kcal, under
    // 1.2 g/kg protein (240 g) + 1 g/kg carbs (200 g).
    expect(
      partitionDayMacros(
        input({
          goal: "maintain",
          dayKcal: 2400,
          mean: { targetCalories: 2400, carbs: 200, fat: 80 },
          proteinGrams: 400,
          weightKg: 200,
        }),
      ),
    ).toEqual({ protein: 240, carbs: 135, fat: 100 });
  });

  it("a day under the fat floor's own energy is all fat", () => {
    expect(
      partitionDayMacros(
        input({ proteinGrams: 300, weightKg: 150, dayKcal: 500 }),
      ),
    ).toEqual({ protein: 0, carbs: 0, fat: 55 });
  });

  it("never plans fat under its floor, whatever protein is asked for", () => {
    for (const dietType of ["balanced", "lowCarb", "lowFat"] as const) {
      for (const goal of ["lose", "maintain", "gain"] as const) {
        for (const weightKg of [45, 80, 120, 160]) {
          for (const gPerKg of [1.2, 2.0, 3.4]) {
            for (let dayKcal = 1200; dayKcal <= 3600; dayKcal += 150) {
              const mean = { targetCalories: dayKcal, carbs: 150, fat: 70 };
              const m = partitionDayMacros(
                input({
                  dayKcal,
                  dayClass: "rest",
                  mean,
                  goal,
                  dietType,
                  weightKg,
                  proteinGrams: gPerKg * weightKg,
                }),
              );
              const share = goal === "lose" ? 0.15 : 0.2;
              const floor = Math.max(0.5 * weightKg, (share * dayKcal) / 9);
              expect(m.fat).toBeGreaterThanOrEqual(floor);
              expect(m.carbs).toBeGreaterThanOrEqual(0);
              expect(Math.abs(kcal(m) - dayKcal)).toBeLessThanOrEqual(45);
            }
          }
        }
      }
    }
  });

  it("at equal calories, carbs never decrease as the day gets harder", () => {
    // Rest → light → training → endurance → heavy.
    const order: TrainingDayClass[] = [
      "rest",
      "light",
      "training",
      "endurance",
      "heavy",
    ];
    // 102 kg on a cut, flat at the 1,870 floor (the case where rest days
    // used to out-carb training days), plus roomier days and fat levels.
    for (const fat of [40, 70, 120]) {
      for (let dayKcal = 1870; dayKcal <= 3200; dayKcal += 110) {
        const carbs = order.map(
          (dayClass) =>
            partitionDayMacros(
              input({
                dayKcal,
                dayClass,
                weightKg: 102,
                proteinGrams: 204,
                mean: { targetCalories: dayKcal, carbs: 150, fat },
              }),
            ).carbs,
        );
        for (let i = 1; i < carbs.length; i++) {
          expect(carbs[i]).toBeGreaterThanOrEqual(carbs[i - 1]);
        }
        // Every non-heavy day gets the same split.
        expect(new Set(carbs.slice(0, 4)).size).toBe(1);
        expect(carbs[0]).toBeGreaterThanOrEqual(102);
      }
    }
  });
});

describe("proteinCeilingGrams / weekProteinGrams", () => {
  const floors = {
    weightKg: 120,
    proteinKg: 120,
    meanKcal: 2150,
    goal: "lose" as const,
    dietType: "balanced" as const,
  };

  it("leaves the fat and carb floors room on the day", () => {
    // 2,150 − 9·60 (fat) − 4·120 (carbs) = 1,130 kcal → 282 g → 280.
    expect(
      proteinCeilingGrams({ ...floors, dayKcal: 2150, proteinGrams: 408 }),
    ).toBe(280);
    // Low-carb has no carb floor: only the fat floor's 540 kcal is held.
    expect(
      proteinCeilingGrams({
        ...floors,
        dietType: "lowCarb",
        dayKcal: 2150,
        proteinGrams: 408,
      }),
    ).toBe(400);
  });

  it("a setting that fits every day is kept as asked", () => {
    expect(
      weekProteinGrams({
        ...floors,
        proteinGrams: 240,
        dayCalories: [2150, 2400, 2150, 2600, 2150, 2400, 2500],
      }),
    ).toEqual({ grams: 240, capped: false });
  });

  it("one that doesn't is cut to the week's smallest day, for every day", () => {
    expect(
      weekProteinGrams({
        ...floors,
        proteinGrams: 408,
        dayCalories: [2600, 2400, 2150, 2600, 2300, 2400, 2500],
      }),
    ).toEqual({ grams: 280, capped: true });
  });
});
