import { describe, expect, it } from "vitest";
import {
  CYCLING_WEIGHTS,
  type DayMacroInput,
  type MacroFloorInput,
  type TrainingDayClass,
  classifyTrainingDay,
  dayKcalForClass,
  distributeWeekCalories,
  explicitFatChoice,
  fatFloorGrams,
  fatFloorLiftsChoice,
  floorsExceedMeanCause,
  normalizeProteinSetting,
  normalizeTrainingSchedule,
  parseTrainingDay,
  partitionDayMacros,
  proteinCeilingGrams,
  minDayKcal,
  proteinGrams,
  proteinWeightKg,
  referenceWeightKg,
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

describe("parseTrainingDay (a per-date override's session)", () => {
  it("keeps a valid session as stored", () => {
    for (const day of MOCKUP_WEEK) expect(parseTrainingDay(day)).toEqual(day);
  });

  for (const raw of [
    undefined,
    null,
    "rest",
    42,
    [],
    {},
    { type: "yoga" },
    { type: 3 },
    { intensity: "hard" },
  ]) {
    it(`a payload with no valid session type (${JSON.stringify(raw)}) → null, not rest`, () => {
      expect(parseTrainingDay(raw)).toBeNull();
    });
  }

  it("drops malformed optional fields and unknown keys, like the template", () => {
    expect(
      parseTrainingDay({
        type: "upper",
        intensity: "extreme",
        time: "7:00",
        durationMin: 0,
        extra: "stripped",
      }),
    ).toEqual({ type: "upper" });
  });

  it("never mutates the stored payload", () => {
    const raw = Object.freeze({ type: "lower", intensity: "nope" });
    parseTrainingDay(raw);
    expect(raw).toEqual({ type: "lower", intensity: "nope" });
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
      bodyFatWouldChangeProtein: false,
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
    expect(out.bodyFatWouldChangeProtein).toBe(false);
  });

  describe("lean mass without a usable estimate → min(2.0, g/kg) × bodyweight", () => {
    // Not the lean-mass 2.6 g/kg applied to bodyweight (208 g): a lean-mass
    // figure is per kg of FFM and over-prescribes on total weight. A lower
    // choice is kept, not raised to the 2.0 default (owner refinement).
    const rows: [number, number][] = [
      [2.6, 160],
      [2.0, 160],
      [1.4, 112],
    ];
    for (const [gPerKg, grams] of rows) {
      it(`${gPerKg} g/kg at 80 kg → ${grams} g`, () => {
        for (const bf of [undefined, null, NaN, 2, 70]) {
          const out = proteinGrams(
            { basis: "leanMass", gPerKg },
            { ...lean, bodyFatPct: bf },
          );
          expect(out.grams).toBeCloseTo(grams, 9);
          expect(out.basis).toBe("bodyweight");
          expect(out.kg).toBe(80);
          // A body-fat estimate would switch it to lean mass.
          expect(out.bodyFatWouldChangeProtein).toBe(true);
        }
      });
    }

    it("then the BMI taper applies to the weight (120 kg / 180 cm → 81 kg)", () => {
      const out = proteinGrams({ basis: "leanMass", gPerKg: 1.4 }, obese);
      expect(out.grams).toBeCloseTo(1.4 * 81, 9);
      expect(out.basis).toBe("referenceWeight");
      expect(out.kg).toBeCloseTo(81, 9);
    });
  });

  it("a bodyweight setting keeps its own g/kg", () => {
    expect(proteinGrams({ basis: "bodyweight", gPerKg: 2.6 }, lean)).toEqual({
      grams: 208,
      basis: "bodyweight",
      kg: 80,
      bodyFatWouldChangeProtein: false,
    });
  });

  describe("BMI > 30 without a body-fat estimate → the tapered weight", () => {
    const rows: [string, Parameters<typeof proteinGrams>, number, string][] = [
      [
        "bodyweight 2.0 at 180 cm / 120 kg (BMI 37) → 2.0 × 81",
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
        "lean mass, no estimate: 2.0 on 81 kg",
        [{ basis: "leanMass", gPerKg: 2.6 }, obese],
        162,
        "referenceWeight",
      ],
      [
        "BMI exactly 30 (200 cm / 120 kg) → bodyweight, no step",
        [
          { basis: "bodyweight", gPerKg: 2 },
          { weightKg: 120, heightCm: 200 },
        ],
        240,
        "bodyweight",
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
        expect(out.bodyFatWouldChangeProtein).toBe(basis === "referenceWeight");
      });
    }

    it("a height that isn't a positive number → bodyweight", () => {
      for (const heightCm of [0, -180, NaN, Infinity]) {
        expect(
          proteinGrams(
            { basis: "bodyweight", gPerKg: 2 },
            { weightKg: 120, heightCm },
          ),
        ).toEqual({
          grams: 240,
          basis: "bodyweight",
          kg: 120,
          bodyFatWouldChangeProtein: false,
        });
      }
    });
  });
});

describe("proteinWeightKg — the BMI taper (180 cm: BMI 30 = 97.2 kg)", () => {
  /** The weight at `bmi` for 180 cm. */
  const at = (bmi: number) => bmi * 1.8 ** 2;
  const rows: [string, number, number][] = [
    ["BMI 29.99 → bodyweight", at(29.99), at(29.99)],
    ["BMI 30 → bodyweight (the BMI-30 weight)", at(30), 97.2],
    ["BMI 32.5 → halfway to the BMI-25 weight", at(32.5), (97.2 + 81) / 2],
    ["BMI 35 → the BMI-25 reference weight", at(35), 81],
    ["BMI 40 → the BMI-25 reference weight", at(40), 81],
  ];
  for (const [name, weightKg, kg] of rows) {
    it(name, () => {
      expect(proteinWeightKg(weightKg, 180)).toBeCloseTo(kg, 9);
    });
  }

  it("the owner's examples: 97.2 → 97.2, 105.3 → ≈ 89, 113.4+ → 81", () => {
    expect(proteinWeightKg(97.2, 180)).toBeCloseTo(97.2, 9);
    expect(proteinWeightKg(105.3, 180)).toBeCloseTo(89.1, 9);
    expect(proteinWeightKg(113.4, 180)).toBeCloseTo(81, 9);
    expect(proteinWeightKg(150, 180)).toBeCloseTo(81, 9);
  });

  it("is continuous: no step anywhere, at BMI 30 and 35 included", () => {
    // Over heights 150–200 cm and weights 40–200 kg, a 1 g change in
    // weight moves the protein weight by at most 1 g (slope −1 inside the
    // taper, +1 below it, 0 above it).
    let worstStep = 0;
    let worstEdge = 0;
    for (let heightCm = 150; heightCm <= 200; heightCm += 2.5) {
      for (let g = 40_000; g < 200_000; g += 7) {
        const a = proteinWeightKg(g / 1000, heightCm);
        const b = proteinWeightKg((g + 1) / 1000, heightCm);
        worstStep = Math.max(worstStep, Math.abs(b - a));
      }
      // Both ends of the taper, approached from either side.
      const m2 = (heightCm / 100) ** 2;
      for (const bmi of [30, 35]) {
        const below = proteinWeightKg(bmi * m2 - 1e-6, heightCm);
        const above = proteinWeightKg(bmi * m2 + 1e-6, heightCm);
        worstEdge = Math.max(worstEdge, Math.abs(above - below));
      }
    }
    expect(worstStep).toBeLessThanOrEqual(0.001 + 1e-9);
    expect(worstEdge).toBeLessThan(1e-5);
  });

  it("never exceeds bodyweight and never goes under the BMI-25 weight", () => {
    for (let heightCm = 150; heightCm <= 200; heightCm += 5) {
      const reference = 25 * (heightCm / 100) ** 2;
      for (let w = 40; w <= 200; w += 0.5) {
        const kg = proteinWeightKg(w, heightCm);
        expect(kg).toBeLessThanOrEqual(w);
        expect(kg).toBeGreaterThanOrEqual(Math.min(w, reference) - 1e-9);
      }
    }
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

describe("dayKcalForClass (an override day under the template week's scale)", () => {
  const MOCKUP = {
    meanKcal: 2200,
    classes: MOCKUP_CLASSES,
    cycling: "modest" as const,
    floorKcal: 1780,
  };

  it("the mockup week: each class gets its template day's planned kcal", () => {
    // Sun Mon Tue Wed Thu Fri Sat = 1950 2300 1950 2500 1950 2250 2500.
    expect(dayKcalForClass(MOCKUP, "rest")).toBe(1950);
    expect(dayKcalForClass(MOCKUP, "heavy")).toBe(2500);
    expect(dayKcalForClass(MOCKUP, "endurance")).toBe(2500);
    // T × w / mean(w) = 2,200 × 1.05 / (7.1 / 7) ≈ 2,277 → the nearest 50.
    expect(dayKcalForClass(MOCKUP, "training")).toBe(2300);
  });

  it("a class the template doesn't use rides the same scale", () => {
    // 2,200 × 1.0 / (7.1 / 7) ≈ 2,169 → 2,150.
    expect(dayKcalForClass(MOCKUP, "light")).toBe(2150);
  });

  it("uses the template's narrowed spread", () => {
    // A 2,000 floor narrows the mockup spread: rest days sit on it, so a
    // rest override does too, and a heavy override gets the same shrunken
    // lift the template's heavy days get.
    const narrowed = { ...MOCKUP, floorKcal: 2000 };
    const week = distributeWeekCalories(narrowed);
    expect(week[2]).toBe(2000);
    expect(dayKcalForClass(narrowed, "rest")).toBe(2000);
    expect(dayKcalForClass(narrowed, "heavy")).toBe(week[3]);
  });

  it("stays inside the day bounds for a class beyond the template's range", () => {
    // An all-rest template: a heavy override's raw 2,200 × 1.25 / 0.8 is
    // capped at 1.25 × the mean.
    const allRest = {
      meanKcal: 2200,
      classes: Array<TrainingDayClass>(7).fill("rest"),
      cycling: "pronounced" as const,
      floorKcal: 1780,
    };
    expect(distributeWeekCalories(allRest)).toEqual(Array(7).fill(2200));
    expect(dayKcalForClass(allRest, "heavy")).toBe(2750);
    // An all-heavy template: a rest override is held at the floor.
    expect(
      dayKcalForClass(
        {
          ...allRest,
          classes: Array<TrainingDayClass>(7).fill("heavy"),
          floorKcal: 1900,
        },
        "rest",
      ),
    ).toBe(1900);
  });

  it("is the mean when the week has no spread to give", () => {
    expect(dayKcalForClass({ ...MOCKUP, cycling: "off" }, "heavy")).toBe(2200);
    // The floor leaves the mean no room (every template day is the mean).
    const pinned = { ...MOCKUP, meanKcal: 1800, floorKcal: 1850 };
    expect(distributeWeekCalories(pinned)).toEqual(Array(7).fill(1800));
    expect(dayKcalForClass(pinned, "rest")).toBe(1800);
    expect(dayKcalForClass(pinned, "heavy")).toBe(1800);
  });
});

describe("partitionDayMacros", () => {
  /** The mockup's mean day: 2,200 kcal on a cut — computeMacros' 40/25/35
   *  split gives 138 g carbs and 86 g fat. 80 kg, 160 g protein. Unless
   *  given, the day is its week's smallest. */
  function input(over: Partial<DayMacroInput> = {}): DayMacroInput {
    const dayKcal = over.dayKcal ?? 2200;
    return {
      dayKcal,
      weekMinKcal: dayKcal,
      mean: { targetCalories: 2200, carbs: 138, fat: 86 },
      proteinGrams: 160,
      floorKg: 80,
      goal: "lose",
      dietType: "balanced",
      explicitFatChoice: false,
      ...over,
    };
  }
  const kcal = (m: { protein: number; carbs: number; fat: number }) =>
    4 * m.protein + 4 * m.carbs + 9 * m.fat;

  it("protein and fat stay put; carbs absorb the day's difference", () => {
    const week = { weekMinKcal: 1950 };
    const rest = partitionDayMacros(input({ ...week, dayKcal: 1950 }));
    const heavy = partitionDayMacros(input({ ...week, dayKcal: 2500 }));
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

  it("an explicit low-fat choice holds down to the 15% hard floor", () => {
    // 60 kg maintaining at 2,200 on a 15%-fat choice (37 g): the default
    // 20% floor (48.9 g) would lift it; the hard floor (36.7 g) doesn't.
    const over = {
      goal: "maintain" as const,
      floorKg: 60,
      proteinGrams: 120,
      mean: { targetCalories: 2200, carbs: 330, fat: 37 },
    };
    expect(
      partitionDayMacros(input({ ...over, explicitFatChoice: true })).fat,
    ).toBe(40); // 37 g, held on the 5 g grid at the floor's step
    expect(partitionDayMacros(input(over)).fat).toBe(50);
  });

  it("the 0.5 g/kg fat floor scales with bodyweight", () => {
    const m = partitionDayMacros(
      input({
        goal: "maintain",
        floorKg: 120,
        proteinGrams: 240,
        mean: { targetCalories: 2200, carbs: 300, fat: 24 },
        dayKcal: 2600,
      }),
    );
    expect(m.fat).toBe(60);
  });

  it("one fat level per week, lowered so the smallest day keeps 1 g/kg carbs", () => {
    // A 120 g-fat week whose smallest planned day is 1,800: 1,800 − 640
    // (protein) − 320 (80 g carbs) leaves 93 g → fat 90 for the WHOLE week,
    // never under its 48.9 g floor; every cycled calorie lands on carbs.
    const week = {
      goal: "maintain" as const,
      weekMinKcal: 1800,
      mean: { targetCalories: 2200, carbs: 110, fat: 120 },
    };
    const rest = partitionDayMacros(input({ ...week, dayKcal: 1800 }));
    const big = partitionDayMacros(input({ ...week, dayKcal: 2600 }));
    expect(rest).toEqual({ protein: 160, carbs: 90, fat: 90 });
    // Not 120 g fat on the big day: fat is one level for the week.
    expect(big).toEqual({ protein: 160, carbs: 290, fat: 90 });
  });

  it("a week whose smallest day fits keeps the split's fat on every day", () => {
    const week = {
      goal: "maintain" as const,
      weekMinKcal: 2100,
      mean: { targetCalories: 2200, carbs: 110, fat: 120 },
    };
    // 2,100 − 640 − 320 leaves 126 g ≥ 120 g: nothing to lower.
    for (const dayKcal of [2100, 2200, 2700]) {
      expect(partitionDayMacros(input({ ...week, dayKcal })).fat).toBe(120);
    }
  });

  it("a heavy day's extra carbs come only from its extra calories", () => {
    // A 2,500 heavy day in a 110 g-fat week whose smallest day is 2,000:
    // 220 g carbs is under the 3 g/kg (240 g) aim, but fat stays at the
    // weekly level — it is never traded down to reach the aim.
    expect(
      partitionDayMacros(
        input({
          goal: "maintain",
          dayKcal: 2500,
          weekMinKcal: 2000,
          mean: { targetCalories: 2200, carbs: 110, fat: 110 },
        }),
      ),
    ).toEqual({ protein: 160, carbs: 220, fat: 110 });
    // At the mean's own calories the split is the mean day's.
    expect(
      partitionDayMacros(
        input({
          goal: "maintain",
          dayKcal: 2000,
          mean: { targetCalories: 2000, carbs: 150, fat: 86 },
        }),
      ),
    ).toEqual({ protein: 160, carbs: 150, fat: 85 });
  });

  it("low-carb: carbs hold at the weekly level and fat moves instead", () => {
    const week = {
      dietType: "lowCarb" as const,
      weekMinKcal: 1950,
      mean: { targetCalories: 2200, carbs: 110, fat: 110 },
    };
    const rest = partitionDayMacros(input({ ...week, dayKcal: 1950 }));
    const heavy = partitionDayMacros(input({ ...week, dayKcal: 2500 }));
    expect(rest).toEqual({ protein: 160, carbs: 110, fat: 95 });
    expect(heavy).toEqual({ protein: 160, carbs: 110, fat: 160 });
  });

  it("low-carb: fat keeps its floor, carbs give way — one level per week", () => {
    // The mirror of the carb-moving rule: a week whose smallest planned day
    // is 1,400 lowers its carbs ONCE, for every day, so that day keeps the
    // 50 g fat floor's energy: (1,400 − 640 − 450) / 4 = 77.5 → 75.
    const week = {
      goal: "maintain" as const,
      dietType: "lowCarb" as const,
      weekMinKcal: 1400,
      mean: { targetCalories: 2200, carbs: 110, fat: 110 },
    };
    const small = partitionDayMacros(input({ ...week, dayKcal: 1400 }));
    expect(small).toEqual({ protein: 160, carbs: 75, fat: 50 });
    expect(small.fat).toBeGreaterThanOrEqual(48.9);
    // A bigger day of the same week keeps the same carbs; fat takes the rest.
    expect(partitionDayMacros(input({ ...week, dayKcal: 2400 }))).toEqual({
      protein: 160,
      carbs: 75,
      fat: 160,
    });
  });

  it("stays energy-consistent with the day's kcal", () => {
    for (const dietType of ["balanced", "lowCarb", "lowFat"] as const) {
      for (let dayKcal = 1800; dayKcal <= 2750; dayKcal += 50) {
        const m = partitionDayMacros(input({ dietType, dayKcal }));
        expect(Math.abs(kcal(m) - dayKcal)).toBeLessThanOrEqual(45);
      }
    }
  });

  it("protein gives way so the fat and carb floors hold", () => {
    // 120 kg on a cut at the 2,150 BMR floor, protein set to 3.4 g/kg
    // (408 g): fat floor 60 g (0.5 g/kg), carb floor 120 g (1 g/kg).
    const m = partitionDayMacros(
      input({
        dayKcal: 2150,
        mean: { targetCalories: 2150, carbs: 135, fat: 70 },
        proteinGrams: 408,
        floorKg: 120,
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
          floorKg: 200,
        }),
      ),
    ).toEqual({ protein: 240, carbs: 135, fat: 100 });
  });

  it("a day under the fat floor's own energy is all fat", () => {
    expect(
      partitionDayMacros(
        input({ proteinGrams: 300, floorKg: 150, dayKcal: 500 }),
      ),
    ).toEqual({ protein: 0, carbs: 0, fat: 55 });
  });

  it("never plans fat under its floor, whatever protein is asked for", () => {
    for (const dietType of ["balanced", "lowCarb", "lowFat"] as const) {
      for (const goal of ["lose", "maintain", "gain"] as const) {
        for (const floorKg of [45, 80, 120, 160]) {
          for (const gPerKg of [1.2, 2.0, 3.4]) {
            for (let dayKcal = 1200; dayKcal <= 3600; dayKcal += 150) {
              const mean = { targetCalories: dayKcal, carbs: 150, fat: 70 };
              const m = partitionDayMacros(
                input({
                  dayKcal,
                  mean,
                  goal,
                  dietType,
                  floorKg,
                  proteinGrams: gPerKg * floorKg,
                }),
              );
              const share = goal === "lose" ? 0.15 : 0.2;
              const floor = Math.max(0.5 * floorKg, (share * dayKcal) / 9);
              expect(m.fat).toBeGreaterThanOrEqual(floor);
              expect(m.carbs).toBeGreaterThanOrEqual(0);
              expect(Math.abs(kcal(m) - dayKcal)).toBeLessThanOrEqual(45);
            }
          }
        }
      }
    }
  });

  it("within a week: one held level, and a bigger day never has fewer carbs", () => {
    for (const dietType of ["balanced", "lowCarb", "lowFat"] as const) {
      for (const fat of [40, 70, 120]) {
        for (let weekMinKcal = 1500; weekMinKcal <= 2600; weekMinKcal += 110) {
          const days = [0, 50, 150, 300, 450, 600].map((extra) =>
            partitionDayMacros(
              input({
                dietType,
                weekMinKcal,
                dayKcal: weekMinKcal + extra,
                floorKg: 102,
                proteinGrams: 204,
                mean: { targetCalories: weekMinKcal + 250, carbs: 150, fat },
              }),
            ),
          );
          const held = days.map((m) =>
            dietType === "lowCarb" ? m.carbs : m.fat,
          );
          expect(new Set(held).size).toBe(1);
          expect(new Set(days.map((m) => m.protein)).size).toBe(1);
          for (let i = 1; i < days.length; i++) {
            expect(days[i].carbs).toBeGreaterThanOrEqual(days[i - 1].carbs);
            expect(days[i].fat).toBeGreaterThanOrEqual(days[i - 1].fat);
          }
        }
      }
    }
  });

  it("keeps the 1 g/kg carb floor, trading fat down no further", () => {
    // 102 kg on a cut, from the 1,870 floor up, at several weekly fat levels:
    // carbs never drop under 1 g/kg, and fat only leaves its weekly level
    // (never its floor) when that is what makes room for them.
    for (const fat of [40, 70, 120]) {
      for (let dayKcal = 1870; dayKcal <= 3200; dayKcal += 110) {
        const m = partitionDayMacros(
          input({
            dayKcal,
            floorKg: 102,
            proteinGrams: 204,
            mean: { targetCalories: dayKcal, carbs: 150, fat },
          }),
        );
        expect(m.carbs).toBeGreaterThanOrEqual(102);
        expect(m.fat).toBeGreaterThanOrEqual(51); // 0.5 g/kg
        if (m.fat < Math.round(fat / 5) * 5) {
          expect(m.carbs).toBeLessThanOrEqual(115); // the 105 g floor + one fat step
        }
      }
    }
  });
});

describe("fatFloorGrams / fatFloorLiftsChoice", () => {
  const base: MacroFloorInput = {
    floorKg: 80,
    meanKcal: 2200,
    goal: "maintain",
    dietType: "balanced",
    explicitFatChoice: false,
  };
  type Over = Partial<MacroFloorInput>;
  const rows: [string, Over, number][] = [
    ["default: 20% of the mean kcal", {}, (0.2 * 2200) / 9],
    ["a cut: 15%, but at least 0.5 g/kg", { goal: "lose" }, 40],
    [
      "an explicit choice: 15%, but at least 0.5 g/kg",
      { explicitFatChoice: true },
      40,
    ],
    [
      "an explicit choice at 60 kg: 15% of the mean kcal",
      { explicitFatChoice: true, floorKg: 60 },
      (0.15 * 2200) / 9,
    ],
    [
      "an explicit choice while gaining: 15%",
      { explicitFatChoice: true, goal: "gain", meanKcal: 3000, floorKg: 60 },
      50,
    ],
    ["0.5 g/kg wins at 120 kg", { floorKg: 120 }, 60],
  ];
  for (const [name, over, grams] of rows) {
    it(name, () => {
      expect(fatFloorGrams({ ...base, ...over })).toBeCloseTo(grams, 9);
    });
  }

  const lifts: [string, Over, number, boolean][] = [
    ["a 10% custom split is lifted", { explicitFatChoice: true }, 24, true],
    [
      "a 15% choice is kept (the floor is 15% too)",
      { explicitFatChoice: true, floorKg: 60 },
      37,
      false,
    ],
    [
      "...even when computeMacros rounded it down (36.33 to 36)",
      { explicitFatChoice: true, floorKg: 60, meanKcal: 2180 },
      36,
      false,
    ],
    [
      "0.5 g/kg lifts a 45 kg user's 15% choice at 1,200 kcal",
      { explicitFatChoice: true, floorKg: 45, meanKcal: 1200 },
      20,
      true,
    ],
    ["a default split is never reported", {}, 24, false],
  ];
  /** A flat week at the mean (its smallest day IS the mean), 2.0 g/kg. */
  const week = (over: Over, meanFat: number, meanCarbs = 150) => {
    const { meanKcal, ...floors } = { ...base, ...over };
    return {
      ...floors,
      weekMinKcal: meanKcal,
      mean: { targetCalories: meanKcal, carbs: meanCarbs, fat: meanFat },
      proteinGrams: 2 * floors.floorKg,
    };
  };
  for (const [name, over, meanFat, lifted] of lifts) {
    it(name, () => {
      expect(fatFloorLiftsChoice(week(over, meanFat))).toBe(lifted);
    });
  }

  describe("low-carb: only when the floor took the week's carbs", () => {
    // A 50/40/10 split at 2,200 (24 g fat, 220 g carbs) beside 160 g
    // protein: fat is whatever is left, (2,200 − 640 − 880) / 9 = 75.6 g on
    // the mean day — far above the 40 g floor (max(15%, 0.5 g/kg) for an
    // explicit choice) that the split's 10% alone would be under.
    const lowCarb = { explicitFatChoice: true, dietType: "lowCarb" as const };
    it("not lifted when the smallest day holds the floor at the split's carbs", () => {
      // 1,950: (1,950 − 640 − 880) / 9 = 47.8 g, over the floor.
      expect(
        fatFloorLiftsChoice({ ...week(lowCarb, 24, 220), weekMinKcal: 1950 }),
      ).toBe(false);
      expect(fatFloorLiftsChoice(week(lowCarb, 24, 220))).toBe(false);
    });
    it("lifted when the floor lowered the week's carbs", () => {
      // 1,760: the split's 220 g carbs would leave 26.7 g fat, so the week's
      // carbs drop to (1,760 − 640 − 360) / 4 = 190.
      expect(
        fatFloorLiftsChoice({ ...week(lowCarb, 24, 220), weekMinKcal: 1760 }),
      ).toBe(true);
    });
    it("not lifted when the floor lowered the carbs of a high-fat choice", () => {
      // A 20/30/50 split at 2,200 (122 g fat, 165 g carbs) at 3.4 g/kg
      // (272 g → 270): the 1,950 smallest day takes the week's carbs to
      // (1,950 − 1,080 − 360) / 4 = 127.5 → 125, yet the plan's fat stays
      // under the 122 g chosen — the floor raised nothing above the choice.
      expect(
        fatFloorLiftsChoice({
          ...week(lowCarb, 122, 165),
          weekMinKcal: 1950,
          proteinGrams: 272,
        }),
      ).toBe(false);
    });
    it("never for a default low-carb split", () => {
      expect(
        fatFloorLiftsChoice({
          ...week({ dietType: "lowCarb" }, 24, 220),
          weekMinKcal: 1760,
        }),
      ).toBe(false);
    });
  });
});

describe("explicitFatChoice", () => {
  it("is the lowFat diet type or a custom split in effect", () => {
    const split = { protein: 40, carbs: 50, fat: 10 };
    expect(explicitFatChoice({ dietType: "lowFat" })).toBe(true);
    expect(explicitFatChoice({ dietType: "balanced", macroSplit: split })).toBe(
      true,
    );
    expect(explicitFatChoice({ dietType: "lowCarb", macroSplit: split })).toBe(
      true,
    );
    expect(explicitFatChoice({ dietType: "balanced" })).toBe(false);
    expect(explicitFatChoice({ dietType: "lowCarb", macroSplit: null })).toBe(
      false,
    );
    // An all-zero split isn't in effect (computeMacros ignores it).
    expect(
      explicitFatChoice({
        dietType: "balanced",
        macroSplit: { protein: 0, carbs: 0, fat: 0 },
      }),
    ).toBe(false);
  });
});

describe("floorsExceedMeanCause", () => {
  /** 120 kg / 180 cm with a body-fat estimate (bodyweight basis), on a cut:
   *  at 2.0 g/kg the floors need 4·240 + 9·60 + 4·120 = 1,980 kcal. */
  const heavy = {
    floorKg: 120,
    goal: "lose" as const,
    dietType: "balanced" as const,
    explicitFatChoice: false,
    body: { weightKg: 120, heightCm: 180, bodyFatPct: 32 },
  };
  type Row = [
    string,
    number,
    Parameters<typeof floorsExceedMeanCause>[0]["setting"],
    string,
  ];
  const rows: Row[] = [
    [
      "3.4 g/kg, fits at 2.0 → protein",
      2155,
      { basis: "bodyweight", gPerKg: 3.4 },
      "protein",
    ],
    [
      "3.4 g/kg, exactly fits at 2.0 → protein",
      1980,
      { basis: "bodyweight", gPerKg: 3.4 },
      "protein",
    ],
    [
      "3.4 g/kg, not even at 2.0 → calories",
      1979,
      { basis: "bodyweight", gPerKg: 3.4 },
      "calories",
    ],
    [
      "the 2.0 default itself → calories",
      1979,
      { basis: "bodyweight", gPerKg: 2 },
      "calories",
    ],
    [
      "a setting under 2.0 → calories",
      1700,
      { basis: "bodyweight", gPerKg: 1.6 },
      "calories",
    ],
  ];
  for (const [name, meanKcal, setting, cause] of rows) {
    it(name, () => {
      expect(floorsExceedMeanCause({ ...heavy, meanKcal, setting })).toBe(
        cause,
      );
    });
  }

  it("lean mass keeps its basis: 2.6 → 2.0 g/kg of lean mass", () => {
    // 80 kg at 20% body fat: 2.0 × 64 = 128 g → 4·130 + 9·40 + 4·80 = 1,200.
    const lean = {
      floorKg: 80,
      goal: "lose" as const,
      dietType: "balanced" as const,
      explicitFatChoice: false,
      setting: { basis: "leanMass" as const, gPerKg: 2.6 },
    };
    const body = { weightKg: 80, heightCm: 180, bodyFatPct: 20 };
    expect(floorsExceedMeanCause({ ...lean, body, meanKcal: 1200 })).toBe(
      "protein",
    );
    expect(floorsExceedMeanCause({ ...lean, body, meanKcal: 1199 })).toBe(
      "calories",
    );
    // Without an estimate the fallback is already 2.0 g/kg bodyweight: a
    // lower setting can't help.
    expect(
      floorsExceedMeanCause({
        ...lean,
        body: { weightKg: 80, heightCm: 180 },
        meanKcal: 1500,
      }),
    ).toBe("calories");
  });
});

describe("proteinCeilingGrams / minDayKcal", () => {
  const floors = {
    floorKg: 120,
    meanKcal: 2150,
    goal: "lose" as const,
    dietType: "balanced" as const,
    explicitFatChoice: false,
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

  it("minDayKcal: the protein setting plus the fat and carb floors", () => {
    // 4·160 + 9·60 (fat) + 4·120 (carbs) on the 5 g grid.
    expect(minDayKcal({ ...floors, proteinGrams: 160 })).toBe(1660);
    // 4·410 (408 → 410) + 540 + 480.
    expect(minDayKcal({ ...floors, proteinGrams: 408 })).toBe(2660);
    // Low-carb has no carb floor.
    expect(
      minDayKcal({ ...floors, dietType: "lowCarb", proteinGrams: 160 }),
    ).toBe(1180);
  });

  it("a day of minDayKcal holds the whole setting", () => {
    for (const proteinGrams of [160, 241, 408]) {
      const dayKcal = minDayKcal({ ...floors, proteinGrams });
      const wanted = Math.round(proteinGrams / 5) * 5;
      expect(proteinCeilingGrams({ ...floors, dayKcal, proteinGrams })).toBe(
        wanted,
      );
      // One kcal less and it doesn't.
      expect(
        proteinCeilingGrams({ ...floors, dayKcal: dayKcal - 1, proteinGrams }),
      ).toBeLessThan(wanted);
    }
  });
});
