import { describe, expect, it } from "vitest";
import { effectiveGoal } from "@maqro/core/goal-phases";
import { computeMacros } from "@maqro/core/macros";
import { targetsForDate, weekTargets } from "@maqro/core/targets";
import type {
  GoalPhase,
  MacroSplit,
  PersonalInfo,
  TrainingSchedule,
  TrainingWeek,
} from "@maqro/core/types";

/** 80 kg / 180 cm / 30 y male on a linear "maintain" goal with a calibrated
 *  2600 kcal maintenance. BMR = 1780, so the safety floor (max(BMR, 1200))
 *  never interferes with the 550 kcal/day cut used below. */
function profile(over: Partial<PersonalInfo> = {}): PersonalInfo {
  return {
    gender: "male",
    age: 30,
    weight: 80,
    height: 180,
    activityLevel: "moderate",
    goal: "maintain",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0,
    manualTdee: 2600,
    units: "metric",
    ...over,
  };
}

/** A 4-week cut at 0.5 kg/week (−550 kcal/day) covering
 *  [2026-06-01, 2026-06-29). */
function cut(over: Partial<GoalPhase> = {}): GoalPhase {
  return {
    id: "ph_cut",
    kind: "cut",
    startDate: "2026-06-01",
    durationWeeks: 4,
    weeklyRateKg: 0.5,
    ...over,
  };
}

const PRO = { phasesEnabled: true };
const FREE = { phasesEnabled: false };

describe("targetsForDate", () => {
  type Row = {
    name: string;
    profile: PersonalInfo;
    date: string;
    ctx: { phasesEnabled: boolean };
    kcal: number;
    tdee: number;
    goal: PersonalInfo["goal"];
    phaseId: string | null;
  };
  const rows: Row[] = [
    {
      name: "no phases → the linear goal",
      profile: profile(),
      date: "2026-06-10",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "active cut without tdeeOverride → global manualTdee − 550",
      profile: profile({ goalPhases: [cut()] }),
      date: "2026-06-10",
      ctx: PRO,
      kcal: 2050,
      tdee: 2600,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "active cut with tdeeOverride → the phase's maintenance − 550",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-10",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "phase start date is inclusive",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-01",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "the day before the phase → linear",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-05-31",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "last day of the phase window → still the cut",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-28",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "phase end date is exclusive → linear",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-29",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "phasesEnabled false (not Pro) ignores a covering phase",
      profile: profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      date: "2026-06-10",
      ctx: FREE,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: null,
    },
    {
      name: "a diet break sits at maintenance (rate forced to 0)",
      profile: profile({
        goalPhases: [
          cut(),
          {
            id: "ph_break",
            kind: "dietBreak",
            startDate: "2026-06-29",
            durationWeeks: 2,
            weeklyRateKg: 0.5,
          },
        ],
      }),
      date: "2026-07-01",
      ctx: PRO,
      kcal: 2600,
      tdee: 2600,
      goal: "maintain",
      phaseId: "ph_break",
    },
    {
      name: "a past date resolves that date's phase, not today's",
      profile: profile({
        goal: "gain",
        weeklyRateKg: 0.25,
        goalPhases: [cut({ startDate: "2025-01-06", tdeeOverride: 2450 })],
      }),
      date: "2025-01-20",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
    {
      name: "a future date resolves a phase that hasn't started yet",
      profile: profile({
        goalPhases: [cut({ startDate: "2027-03-01", tdeeOverride: 2450 })],
      }),
      date: "2027-03-02",
      ctx: PRO,
      kcal: 1900,
      tdee: 2450,
      goal: "lose",
      phaseId: "ph_cut",
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const t = targetsForDate(row.profile, row.date, row.ctx);
      expect(t.date).toBe(row.date);
      expect(t.targetCalories).toBe(row.kcal);
      expect(t.tdee).toBe(row.tdee);
      expect(t.goal).toBe(row.goal);
      expect(t.phase?.id ?? null).toBe(row.phaseId);
    });
  }

  it("is bit-identical to computeMacros for the linear goal (no phase)", () => {
    const p = profile({ manualTdee: null, goal: "lose", weeklyRateKg: 0.4 });
    const date = "2026-06-10";
    expect(targetsForDate(p, date, FREE)).toEqual({
      ...computeMacros(p, new Date(2026, 5, 10).getTime(), undefined),
      date,
      goal: "lose",
      phase: null,
    });
  });

  it("macros follow the phase-driven calories (cut ratios)", () => {
    const t = targetsForDate(
      profile({ goalPhases: [cut({ tdeeOverride: 2450 })] }),
      "2026-06-10",
      PRO,
    );
    // lose split 40/25/35 of 1900 kcal
    expect(t.protein).toBe(190);
    expect(t.carbs).toBe(119);
    expect(t.fat).toBe(74);
  });

  it("pins the age clock to the target date (a birthday rolls the BMR)", () => {
    // Formula TDEE (no manualTdee) so the BMR change reaches the target.
    const p = profile({ manualTdee: null, birthDate: "1996-06-15" });
    const before = targetsForDate(p, "2026-06-14", FREE); // 29
    const on = targetsForDate(p, "2026-06-15", FREE); // 30
    expect(before.bmr - on.bmr).toBe(5);
    expect(before.targetCalories).toBeGreaterThan(on.targetCalories);
  });

  it("falls back to the present clock for a non-date key", () => {
    const p = profile();
    const t = targetsForDate(p, "", PRO);
    expect(t.targetCalories).toBe(2600);
    expect(t.phase).toBeNull();
  });
});

/** The mockup week, indexed by `getDay()` (0 = Sunday): Mon upper moderate,
 *  Tue rest, Wed lower hard, Thu rest, Fri full body moderate, Sat long
 *  endurance (90 min), Sun rest. */
const MOCKUP_WEEK: TrainingWeek = [
  { type: "rest" },
  { type: "upper", intensity: "moderate", time: "18:00", durationMin: 60 },
  { type: "rest" },
  { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
  { type: "rest" },
  { type: "fullBody", intensity: "moderate", time: "07:00", durationMin: 60 },
  { type: "endurance", intensity: "moderate", time: "09:00", durationMin: 90 },
];

function schedule(over: Partial<TrainingSchedule> = {}): TrainingSchedule {
  return { enabled: true, days: MOCKUP_WEEK, cycling: "modest", ...over };
}

/** Local `YYYY-MM-DD` keys of the 7 days starting at `start`. */
function weekOf(start: string): string[] {
  const [y, m, d] = start.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(y, m - 1, d + i);
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${dt.getFullYear()}-${mm}-${dd}`;
  });
}

describe("targetsForDate — without enabled training, byte for byte today's", () => {
  const goals: PersonalInfo["goal"][] = ["lose", "maintain", "gain"];
  const diets: PersonalInfo["dietType"][] = ["balanced", "lowCarb", "lowFat"];
  const splits: (MacroSplit | null)[] = [
    null,
    { protein: 30, carbs: 40, fat: 30 },
    { protein: 20, carbs: 20, fat: 60 },
  ];
  const trainings: unknown[] = [
    undefined,
    schedule({ enabled: false, cycling: "pronounced" }),
    schedule({ enabled: false, cycling: "off" }),
    { ...schedule(), enabled: "true" },
    { enabled: true, days: "mon,wed", cycling: "modest" },
    { enabled: true, days: MOCKUP_WEEK.slice(0, 6), cycling: "modest" },
    "garbage",
  ];
  // A Pro cut starting mid-week, so the phase varies by date too.
  const phases = [cut({ startDate: "2026-06-11", tdeeOverride: 2450 })];
  const dates = weekOf("2026-06-08");

  for (const goal of goals) {
    for (const dietType of diets) {
      it(`${goal} / ${dietType}, every split, TDEE source, tier and day`, () => {
        for (const macroSplit of splits) {
          for (const manualTdee of [null, 2600]) {
            for (const ctx of [PRO, FREE]) {
              const plain = profile({
                goal,
                dietType,
                macroSplit,
                manualTdee,
                weeklyRateKg: goal === "maintain" ? 0 : 0.4,
                goalPhases: phases,
              });
              for (const date of dates) {
                const eff = effectiveGoal(plain, date, ctx);
                const [y, m, d] = date.split("-").map(Number);
                const expected = {
                  ...computeMacros(
                    {
                      ...plain,
                      goal: eff.goal,
                      weeklyRateKg: eff.weeklyRateKg,
                    },
                    new Date(y, m - 1, d).getTime(),
                    eff.phase?.tdeeOverride ?? undefined,
                  ),
                  date,
                  goal: eff.goal,
                  phase: eff.phase,
                };
                expect(targetsForDate(plain, date, ctx)).toStrictEqual(
                  expected,
                );
                for (const training of trainings) {
                  for (const proteinSetting of [
                    undefined,
                    { basis: "leanMass" as const, gPerKg: 2.6 },
                  ]) {
                    // `training` is deliberately malformed in some rows: the
                    // payload is jsonb that nothing validates on write.
                    const withTraining = {
                      ...plain,
                      training,
                      proteinSetting,
                    } as PersonalInfo;
                    expect(
                      targetsForDate(withTraining, date, {
                        ...ctx,
                        bodyFatPct: 18,
                      }),
                    ).toStrictEqual(expected);
                  }
                }
              }
            }
          }
        }
      });
    }
  }
});

/** The mockup: 80 kg / 180 cm / 30 y male (BMR and floor 1,780) cutting
 *  0.4 kg/week from a 2,640 maintenance → a 2,200 kcal weekly mean. */
function mockupProfile(over: Partial<PersonalInfo> = {}): PersonalInfo {
  return profile({
    goal: "lose",
    weeklyRateKg: 0.4,
    manualTdee: 2640,
    training: schedule(),
    ...over,
  });
}
/** Mon 2026-10-19 → Sun 2026-10-25. */
const MOCKUP_DATES = weekOf("2026-10-19");

describe("targetsForDate — training days", () => {
  it("the mockup week: planned days around an unchanged 2,200 average", () => {
    const week = weekTargets(mockupProfile(), "2026-10-21", FREE);
    if (!week) throw new Error("expected a week");
    expect(week.weekStart).toBe("2026-10-19");
    expect(week.days.map((d) => d.date)).toEqual(MOCKUP_DATES);
    // Mon Tue Wed Thu Fri Sat Sun
    expect(week.days.map((d) => d.targetCalories)).toEqual([
      2300, 1950, 2500, 1950, 2250, 2500, 1950,
    ]);
    expect(week.totalCalories).toBe(15400); // 7 × 2,200, nothing added on top
    expect(week.days.map((d) => d.training?.dayClass)).toEqual([
      "training",
      "rest",
      "heavy",
      "rest",
      "training",
      "endurance",
      "rest",
    ]);
    // Protein fixed at 2.0 g/kg; fat held at the cut split's 86 g → 85;
    // carbs carry the difference.
    expect(week.days.map((d) => d.protein)).toEqual(Array(7).fill(160));
    expect(week.days.map((d) => d.fat)).toEqual(Array(7).fill(85));
    expect(week.days.map((d) => d.carbs)).toEqual([
      225, 135, 275, 135, 210, 275, 135,
    ]);
    for (const d of week.days) {
      // The weekly energy balance is untouched.
      expect(d.bmr).toBe(1780);
      expect(d.tdee).toBe(2640);
      expect(d.dailyDelta).toBe(-440);
      expect(d.requestedDelta).toBe(-440);
      expect(d.goal).toBe("lose");
      expect(d.training?.meanCalories).toBe(2200);
      expect(d.training?.cycling).toBe("modest");
      expect(d.training?.proteinBasis).toBe("bodyweight");
      expect(d.training?.bodyFatWouldChangeProtein).toBe(false);
      expect(d.training?.fatFloorLifted).toBe(false);
    }
    expect(week.days[2].training?.day).toEqual(MOCKUP_WEEK[3]);
  });

  it("a single date resolves the same day as its week", () => {
    const p = mockupProfile();
    const week = weekTargets(p, "2026-10-25", FREE);
    MOCKUP_DATES.forEach((date, i) => {
      expect(targetsForDate(p, date, FREE)).toStrictEqual(week?.days[i]);
    });
  });

  it("cycling off: flat days — only the fixed protein applies", () => {
    const week = weekTargets(
      mockupProfile({ training: schedule({ cycling: "off" }) }),
      "2026-10-19",
      FREE,
    );
    expect(week?.days).toHaveLength(7);
    // Every day, the heavy Wednesday included, has the same macros: no
    // per-day shifts without cycled calories (fat held at the cut split's
    // 86 g → 85; carbs take the rest).
    expect(week?.days[2].training?.dayClass).toBe("heavy");
    for (const d of week?.days ?? []) {
      expect(d.targetCalories).toBe(2200);
      expect([d.protein, d.carbs, d.fat]).toEqual([160, 200, 85]);
    }
  });

  it("a heavy day's extra carbs come only from its cycled calories", () => {
    // A high-fat custom split (30/25/45 → 110 g fat at 2,200): heavy
    // Wednesday (2,500) gets 2,500 − 2,200 = 300 kcal more carbs than the
    // mean day, under the 3 g/kg aim (240 g), and fat stays at 110.
    const days =
      weekTargets(
        mockupProfile({ macroSplit: { protein: 30, carbs: 25, fat: 45 } }),
        "2026-10-19",
        FREE,
      )?.days ?? [];
    expect(days).toHaveLength(7);
    const wed = days[2];
    expect(wed.training?.dayClass).toBe("heavy");
    expect(wed.targetCalories).toBe(2500);
    expect([wed.protein, wed.carbs, wed.fat]).toEqual([160, 220, 110]);
    for (const d of days) expect(d.fat).toBe(110);
  });

  describe("one fat level per week (owner refinement, 2026-10-24)", () => {
    /** The owner's reproduction: 100 kg / 190 cm / 30 y moderately active
     *  male cutting 0.5 kg/week (a 2,616 kcal mean), 3.4 g/kg protein
     *  (340 g), pronounced cycling over the mockup week. */
    const heavyCut = (over: Partial<PersonalInfo> = {}) =>
      profile({
        weight: 100,
        height: 190,
        goal: "lose",
        weeklyRateKg: 0.5,
        manualTdee: null,
        training: schedule({ cycling: "pronounced" }),
        proteinSetting: { basis: "bodyweight", gPerKg: 3.4 },
        ...over,
      });

    it("cycled calories land on carbs; fat is one level all week", () => {
      const week = weekTargets(heavyCut(), "2026-10-19", FREE);
      const days = week?.days ?? [];
      expect(days).toHaveLength(7);
      // Mon Tue Wed Thu Fri Sat Sun — the day calories are unchanged.
      expect(days.map((d) => d.targetCalories)).toEqual([
        2750, 2250, 3050, 2250, 2750, 3000, 2250,
      ]);
      expect(days[0].training?.meanCalories).toBe(2616);
      // The cut split's 102 g fat can't stay: the 2,250 rest days need
      // 340 g protein + 100 g carbs (1 g/kg), leaving 54 g → 50, which is
      // also the 0.5 g/kg floor. It was 100 g on the bigger days, so their
      // cycled calories went to fat; now every day is 50 g and carbs carry
      // the whole spread (110 g on rest days → 310 g on heavy Wednesday).
      expect(days.map((d) => d.fat)).toEqual(Array(7).fill(50));
      expect(days.map((d) => d.protein)).toEqual(Array(7).fill(340));
      expect(days.map((d) => d.carbs)).toEqual([
        235, 110, 310, 110, 235, 300, 110,
      ]);
      expect(days.every((d) => d.training?.floorsExceedMean === false)).toBe(
        true,
      );
    });

    it("low-carb mirrors it: carbs are one level all week, fat moves", () => {
      const days =
        weekTargets(heavyCut({ dietType: "lowCarb" }), "2026-10-19", FREE)
          ?.days ?? [];
      expect(days).toHaveLength(7);
      expect(days.map((d) => d.targetCalories)).toEqual([
        2800, 2100, 3200, 2100, 2800, 3200, 2100,
      ]);
      // The low-carb split's 100 g carbs leave the 2,100 rest days under
      // the 50 g fat floor beside 340 g protein, so the WEEK's carbs drop to
      // (2,100 − 1,360 − 450) / 4 = 72.5 → 70 — not just the rest days'.
      expect(days.map((d) => d.carbs)).toEqual(Array(7).fill(70));
      expect(days.map((d) => d.fat)).toEqual([130, 50, 175, 50, 130, 175, 50]);
    });
  });

  it("pronounced moves more between days, same weekly total", () => {
    const spread = (cycling: TrainingSchedule["cycling"]) => {
      const p = mockupProfile({ training: schedule({ cycling }) });
      const kcal =
        weekTargets(p, "2026-10-19", FREE)?.days.map((d) => d.targetCalories) ??
        [];
      return {
        total: kcal.reduce((s, k) => s + k, 0),
        range: Math.max(...kcal) - Math.min(...kcal),
      };
    };
    const modest = spread("modest");
    const pronounced = spread("pronounced");
    expect(pronounced.total).toBe(15400);
    expect(pronounced.range).toBeGreaterThan(modest.range);
  });

  it("lean-mass protein uses the caller's body-fat estimate", () => {
    const p = mockupProfile({
      proteinSetting: { basis: "leanMass", gPerKg: 2.6 },
    });
    const lean = targetsForDate(p, "2026-10-20", { ...FREE, bodyFatPct: 20 });
    expect(lean.protein).toBe(165); // 2.6 × 64 kg = 166.4 → 165
    expect(lean.training?.proteinBasis).toBe("leanMass");
    expect(lean.training?.bodyFatWouldChangeProtein).toBe(false);
    // No estimate → min(2.0, 2.6) g/kg on bodyweight (2.0 × 80 = 160), not
    // the lean-mass 2.6 g/kg on bodyweight (208).
    const noEstimate = targetsForDate(p, "2026-10-20", FREE);
    expect(noEstimate.protein).toBe(160);
    expect(noEstimate.training?.proteinBasis).toBe("bodyweight");
    // `proteinBasis` reads the same as a chosen bodyweight setting; this
    // tells the UI a body-fat estimate would change the target.
    expect(noEstimate.training?.bodyFatWouldChangeProtein).toBe(true);
    // A lower lean-mass choice is kept, not raised to 2.0: 1.4 × 80 = 112.
    const low = targetsForDate(
      mockupProfile({ proteinSetting: { basis: "leanMass", gPerKg: 1.4 } }),
      "2026-10-20",
      FREE,
    );
    expect(low.protein).toBe(110); // 112 on the 5 g grid
    expect(low.training?.bodyFatWouldChangeProtein).toBe(true);
    // A chosen bodyweight setting under BMI 30: nothing to add.
    const chosen = targetsForDate(mockupProfile(), "2026-10-20", FREE);
    expect(chosen.training?.proteinBasis).toBe("bodyweight");
    expect(chosen.training?.bodyFatWouldChangeProtein).toBe(false);
  });

  it("a macroSplit override sets the held fat; protein stays g/kg", () => {
    const week = weekTargets(
      mockupProfile({ macroSplit: { protein: 40, carbs: 40, fat: 20 } }),
      "2026-10-19",
      FREE,
    );
    expect(week?.days).toHaveLength(7);
    for (const d of week?.days ?? []) {
      expect(d.protein).toBe(160);
      expect(d.fat).toBe(50); // 20% of 2,200 = 49 g → 50
      expect(d.training?.fatFloorLifted).toBe(false);
    }
  });

  describe("fat floor while training", () => {
    it("lifts an explicit custom split under 15%, and says so", () => {
      // Maintaining at 2,600 on a 10%-fat split (29 g): the hard floor is
      // max(15% → 43.3 g, 0.5 g/kg → 40 g); the default 20% would be 57.8 g.
      const p = profile({
        training: schedule(),
        macroSplit: { protein: 40, carbs: 50, fat: 10 },
      });
      const days = weekTargets(p, "2026-10-19", FREE)?.days ?? [];
      expect(days).toHaveLength(7);
      for (const d of days) {
        expect(d.fat).toBe(45);
        expect(d.training?.fatFloorLifted).toBe(true);
      }
    });

    it("keeps an explicit 15% low-fat choice, and doesn't flag it", () => {
      // 60 kg maintaining at 2,180 on lowFat (15% → 36.33 g, rounded to 36
      // by computeMacros): the floor is the same 15%, so nothing is lifted.
      const p = profile({
        weight: 60,
        manualTdee: 2180,
        dietType: "lowFat",
        training: schedule(),
      });
      const days = weekTargets(p, "2026-10-19", FREE)?.days ?? [];
      expect(days).toHaveLength(7);
      expect(days[0].training?.meanCalories).toBe(2180);
      for (const d of days) {
        expect(d.fat).toBe(40); // the 36.33 g floor's 5 g step
        expect(d.training?.fatFloorLifted).toBe(false);
      }
      // Without the explicit choice the default 20% floor (48.4 g) applies.
      const balanced =
        weekTargets({ ...p, dietType: "balanced" }, "2026-10-19", FREE)?.days ??
        [];
      expect(balanced).toHaveLength(7);
      for (const d of balanced) expect(d.fat).toBeGreaterThanOrEqual(50);
    });
  });

  it("low-carb: carbs hold steady and fat moves", () => {
    const days =
      weekTargets(mockupProfile({ dietType: "lowCarb" }), "2026-10-19", FREE)
        ?.days ?? [];
    expect(days).toHaveLength(7);
    expect(new Set(days.map((d) => d.carbs)).size).toBe(1);
    expect(days[0].carbs).toBe(85); // the low-carb cut split's 83 g → 85
    expect(days[2].fat).toBeGreaterThan(days[1].fat); // heavy Wed > rest Tue
  });

  it("a Pro phase sets the mean; the safety floor narrows the spread", () => {
    // Maintain at 2,600; the cut (2,450 − 550 = 1,900) covers this week.
    const p = profile({
      training: schedule(),
      goalPhases: [cut({ tdeeOverride: 2450 })],
    });
    const pro = weekTargets(p, "2026-06-10", PRO);
    const kcal = pro?.days.map((d) => d.targetCalories) ?? [];
    expect(pro?.totalCalories).toBe(7 * 1900);
    // Unconstrained the rest days would be ~1,698: under the 1,780 floor.
    expect(Math.min(...kcal)).toBeGreaterThanOrEqual(1780);
    expect(pro?.days[0].training?.meanCalories).toBe(1900);
    expect(weekTargets(p, "2026-06-10", FREE)?.totalCalories).toBe(7 * 2600);
  });

  it("BMI ≥ 35 without a body-fat estimate: g/kg on the BMI-25 weight", () => {
    // 120 kg / 180 cm (BMI 37): 2.0 g/kg × 81 kg = 162 g → 160.
    const p = mockupProfile({ weight: 120 });
    const t = targetsForDate(p, "2026-10-20", FREE);
    expect(t.protein).toBe(160);
    expect(t.training?.proteinBasis).toBe("referenceWeight");
    expect(t.training?.bodyFatWouldChangeProtein).toBe(true);
    // With an estimate, the bodyweight setting applies as set (240 g).
    const withEstimate = targetsForDate(p, "2026-10-20", {
      ...FREE,
      bodyFatPct: 32,
    });
    expect(withEstimate.protein).toBe(240);
    expect(withEstimate.training?.proteinBasis).toBe("bodyweight");
    expect(withEstimate.training?.bodyFatWouldChangeProtein).toBe(false);
  });

  it("BMI 30–35 without a body-fat estimate: protein tapers, no step", () => {
    // 180 cm, 2.0 g/kg: 97.2 kg (BMI 30) → 194.4 g; 105.3 kg (BMI 32.5) →
    // 2.0 × 89.1 = 178.2 g; 113.4 kg (BMI 35) → 2.0 × 81 = 162 g.
    const protein = (weight: number) =>
      targetsForDate(mockupProfile({ weight }), "2026-10-20", FREE).protein;
    expect(protein(97.2)).toBe(195);
    expect(protein(105.3)).toBe(180);
    expect(protein(113.4)).toBe(160);
    // Just over BMI 30 is within a gram of just under it.
    expect(protein(97.3)).toBe(195);
    expect(protein(97.1)).toBe(195);
    const t = targetsForDate(
      mockupProfile({ weight: 105.3 }),
      "2026-10-20",
      FREE,
    );
    expect(t.training?.proteinBasis).toBe("referenceWeight");
    expect(t.training?.bodyFatWouldChangeProtein).toBe(true);
  });

  it("cycling narrows rather than plan a day too small for the floors", () => {
    // 100 kg / 180 cm male maintaining at 2,400 (BMR 1,980), 3.4 g/kg protein
    // (340 g; a body-fat estimate keeps the bodyweight basis at BMI 30.9):
    // the smallest day that holds it beside the 55 g fat and 100 g carb
    // floors is 4·340 + 9·55 + 4·100 = 2,255 kcal. Without narrowing,
    // pronounced rest days would be ~1,893 (2,000 under the kcal floor).
    const ctx = { ...FREE, bodyFatPct: 25 };
    const p = profile({
      weight: 100,
      manualTdee: 2400,
      training: schedule({ cycling: "pronounced" }),
      proteinSetting: { basis: "bodyweight", gPerKg: 3.4 },
    });
    const week = weekTargets(p, "2026-10-19", ctx);
    const days = week?.days ?? [];
    expect(days).toHaveLength(7);
    expect(week?.totalCalories).toBe(7 * 2400);
    // Mon Tue Wed Thu Fri Sat Sun: still a spread, just a narrower one.
    expect(days.map((d) => d.targetCalories)).toEqual([
      2450, 2300, 2500, 2300, 2450, 2500, 2300,
    ]);
    for (const d of days) {
      expect(d.protein).toBe(340);
      expect(d.fat).toBeGreaterThanOrEqual(55);
      expect(d.carbs).toBeGreaterThanOrEqual(100);
      expect(d.training?.floorsExceedMean).toBe(false);
    }
    // At the default 2.0 g/kg only the kcal floor narrows it.
    const kcal =
      weekTargets(
        { ...p, proteinSetting: undefined },
        "2026-10-19",
        ctx,
      )?.days.map((d) => d.targetCalories) ?? [];
    expect(Math.min(...kcal)).toBe(2000);
  });

  it("BMI > 30 without body fat: the per-kg floors use the protein weight", () => {
    // 120 kg / 180 cm (BMI 37 → 81 kg) on an explicit 10%-fat split at a
    // flat 2,200 (the 2,180 BMR floor leaves no room to cycle): the fat
    // floor is max(0.5 g/kg × 81 = 40.5, 15% → 36.7) → 45, not the 60 g of
    // 0.5 g/kg bodyweight.
    const p = mockupProfile({
      weight: 120,
      macroSplit: { protein: 40, carbs: 50, fat: 10 },
    });
    for (const d of weekTargets(p, "2026-10-19", FREE)?.days ?? []) {
      expect(d.targetCalories).toBe(2200);
      expect([d.protein, d.carbs, d.fat]).toEqual([160, 290, 45]);
    }
    // With a body-fat estimate protein and the floors are on bodyweight.
    const withEstimate = targetsForDate(p, "2026-10-20", {
      ...FREE,
      bodyFatPct: 32,
    });
    expect([
      withEstimate.protein,
      withEstimate.carbs,
      withEstimate.fat,
    ]).toEqual([240, 175, 60]);
  });

  it("floors over the mean at BMI > 30 without body fat: all on the protein weight", () => {
    // 150 cm / 81 kg woman (BMI 36 → the 56.25 kg reference weight), 75,
    // sedentary, cutting at her 1,212 kcal BMR floor with 3.4 g/kg
    // (191.25 g): 4·190 + 9·30 + 4·60 = 1,270 kcal of floors don't fit.
    // Every floor is on the 56.25 kg protein weight: fat max(28.1, 15% →
    // 20.2) → 30, carbs 1 g/kg → 60, protein ≥ 1.2 g/kg → 70; protein
    // gives way to (1,212 − 270 − 240) / 4 = 175.5 → 175. On bodyweight
    // (81 kg) the floors would be 45 g fat and 85 g carbs, protein 115.
    const p = profile({
      gender: "female",
      age: 75,
      weight: 81,
      height: 150,
      activityLevel: "sedentary",
      goal: "lose",
      weeklyRateKg: 0.8,
      manualTdee: null,
      training: schedule(),
      proteinSetting: { basis: "bodyweight", gPerKg: 3.4 },
    });
    const days = weekTargets(p, "2026-10-19", FREE)?.days ?? [];
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(d.training?.proteinBasis).toBe("referenceWeight");
      expect(d.training?.floorsExceedMean).toBeTruthy();
      expect(d.targetCalories).toBe(1212);
      expect([d.protein, d.carbs, d.fat]).toEqual([175, 60, 30]);
      expect(d.protein).toBeGreaterThanOrEqual(1.2 * 56.25);
    }
  });

  it("protein gives way to the fat and carb floors, the same every day", () => {
    // 120 kg / 180 cm / 35 y sedentary male cutting 0.5 kg/week: the cut
    // lands under the 2,155 BMR floor, so every day sits at 2,155. A
    // body-fat estimate keeps the bodyweight basis (BMI 37 would otherwise
    // take the 81 kg reference weight).
    const ctx = { ...FREE, bodyFatPct: 32 };
    const p = profile({
      weight: 120,
      age: 35,
      activityLevel: "sedentary",
      goal: "lose",
      weeklyRateKg: 0.5,
      manualTdee: null,
      training: schedule(),
      proteinSetting: { basis: "bodyweight", gPerKg: 3.4 },
    });
    const days = weekTargets(p, "2026-10-19", ctx)?.days ?? [];
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(d.targetCalories).toBe(2155);
      // 3.4 g/kg (408 g) doesn't fit beside 60 g fat + 120 g carbs even on
      // the mean day: protein gives way, and the UI is told.
      expect(d.protein).toBe(280);
      expect(d.training?.floorsExceedMean).toBe(true);
      expect(d.fat).toBeGreaterThanOrEqual(60);
      expect(d.carbs).toBeGreaterThanOrEqual(120);
    }
    // The default 2.0 g/kg (240 g) fits, so nothing gives way.
    const byDefault = targetsForDate(
      { ...p, proteinSetting: undefined },
      "2026-10-20",
      ctx,
    );
    expect(byDefault.protein).toBe(240);
    expect(byDefault.training?.floorsExceedMean).toBe(false);
  });

  describe("floors hold across a grid of profiles and settings", () => {
    const round5 = (x: number) => Math.round(x / 5) * 5;
    const goals: [PersonalInfo["goal"], number][] = [
      ["lose", 0.5],
      ["lose", 1.0],
      ["maintain", 0],
      ["gain", 0.25],
    ];
    for (const dietType of ["balanced", "lowCarb", "lowFat"] as const) {
      for (const cycling of ["modest", "pronounced", "off"] as const) {
        it(`${dietType}, cycling ${cycling}`, () => {
          for (const weight of [45, 62, 80, 102, 120, 140, 160]) {
            for (const height of [155, 180]) {
              for (const gender of ["male", "female"] as const) {
                for (const activityLevel of ["sedentary", "active"] as const) {
                  for (const [goal, weeklyRateKg] of goals) {
                    for (const gPerKg of [1.2, 2.0, 3.4]) {
                      const p = profile({
                        weight,
                        height,
                        gender,
                        activityLevel,
                        goal,
                        weeklyRateKg,
                        dietType,
                        manualTdee: null,
                        training: schedule({ cycling }),
                        proteinSetting: { basis: "bodyweight", gPerKg },
                      });
                      const days = weekTargets(p, "2026-10-19", FREE)?.days;
                      if (!days) throw new Error("expected a week");
                      const mean = days[0].training?.meanCalories ?? 0;
                      // BMI > 30 (no body-fat estimate here) → g/kg on
                      // the weight tapering from the BMI-30 weight (at 30)
                      // to the BMI-25 weight (from 35 up).
                      const m2 = (height / 100) ** 2;
                      const bmi = weight / m2;
                      const proteinKg =
                        bmi <= 30
                          ? weight
                          : bmi >= 35
                            ? 25 * m2
                            : 30 * m2 + ((bmi - 30) / 5) * (25 * m2 - 30 * m2);
                      const wanted = round5(gPerKg * proteinKg);
                      // 15% in a cut or for the explicit lowFat choice; the
                      // per-kg floors follow the protein weight.
                      const share =
                        goal === "lose" || dietType === "lowFat" ? 0.15 : 0.2;
                      const fatFloor = Math.max(
                        0.5 * proteinKg,
                        (share * mean) / 9,
                      );
                      expect(new Set(days.map((d) => d.protein)).size).toBe(1);
                      for (const d of days) {
                        expect(d.fat).toBeGreaterThanOrEqual(fatFloor);
                        if (dietType !== "lowCarb") {
                          expect(d.carbs).toBeGreaterThanOrEqual(proteinKg);
                        }
                        // Protein only gives way when even the mean day
                        // can't fit the floors — and then every day is it.
                        const tight = d.training?.floorsExceedMean;
                        if (d.protein < wanted) expect(tight).toBe(true);
                        if (tight) expect(d.targetCalories).toBe(mean);
                        else expect(d.protein).toBe(wanted);
                        // Within half a step of the moving macro.
                        const kcal = 4 * (d.protein + d.carbs) + 9 * d.fat;
                        expect(
                          Math.abs(kcal - d.targetCalories),
                        ).toBeLessThanOrEqual(
                          dietType === "lowCarb" ? 22.5 : 10,
                        );
                      }
                      // One held level per week: fat on carb-moving diets,
                      // carbs on low-carb.
                      const held = days.map((d) =>
                        dietType === "lowCarb" ? d.carbs : d.fat,
                      );
                      expect(new Set(held).size).toBe(1);
                      // A bigger day never has fewer carbs (or fat).
                      for (const a of days) {
                        for (const b of days) {
                          if (a.targetCalories > b.targetCalories) {
                            expect(a.carbs).toBeGreaterThanOrEqual(b.carbs);
                            expect(a.fat).toBeGreaterThanOrEqual(b.fat);
                          }
                        }
                      }
                      // Same calories → same macros, whatever the class.
                      for (const a of days) {
                        for (const b of days) {
                          if (a.targetCalories === b.targetCalories) {
                            expect([b.protein, b.carbs, b.fat]).toEqual([
                              a.protein,
                              a.carbs,
                              a.fat,
                            ]);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        });
      }
    }
  });

  it("a key that isn't a calendar date has no week and no training day", () => {
    expect(weekTargets(mockupProfile(), "", FREE)).toBeNull();
    expect(weekTargets(mockupProfile(), "2026-02-31", FREE)).toBeNull();
    const t = targetsForDate(mockupProfile(), "", FREE);
    expect(t.training).toBeUndefined();
    expect(t.targetCalories).toBe(2200);
  });
});
