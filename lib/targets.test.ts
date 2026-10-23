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
      2300, 2000, 2500, 1950, 2300, 2400, 1950,
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
      225, 150, 275, 135, 225, 250, 135,
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

  it("cycling off: every day at the average, protein still fixed", () => {
    const week = weekTargets(
      mockupProfile({ training: schedule({ cycling: "off" }) }),
      "2026-10-19",
      FREE,
    );
    expect(week?.days).toHaveLength(7);
    for (const d of week?.days ?? []) {
      expect(d.targetCalories).toBe(2200);
      expect(d.protein).toBe(160);
    }
    const [mon, , wed] = week?.days ?? [];
    expect([mon.fat, mon.carbs]).toEqual([85, 200]);
    // Wednesday is heavy: at 2,200 kcal its carbs (199 g) are under the
    // 3 g/kg aim, so fat trades down (above its 40 g floor) to make room.
    expect(wed.training?.dayClass).toBe("heavy");
    expect(wed.fat).toBe(65);
    expect(wed.carbs).toBeGreaterThanOrEqual(240);
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
    // No estimate → bodyweight basis (2.6 × 80 = 208 → 210).
    const noEstimate = targetsForDate(p, "2026-10-20", FREE);
    expect(noEstimate.protein).toBe(210);
    expect(noEstimate.training?.proteinBasis).toBe("bodyweight");
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
    }
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

  it("protein gives way to the fat and carb floors, the same every day", () => {
    // 120 kg / 180 cm / 35 y sedentary male cutting 0.5 kg/week: the cut
    // lands under the 2,155 BMR floor, so every day sits at 2,155.
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
    const days = weekTargets(p, "2026-10-19", FREE)?.days ?? [];
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(d.targetCalories).toBe(2155);
      // 3.4 g/kg (408 g) doesn't fit beside 60 g fat + 120 g carbs.
      expect(d.protein).toBe(280);
      expect(d.training?.proteinCapped).toBe(true);
      expect(d.fat).toBeGreaterThanOrEqual(60);
      expect(d.carbs).toBeGreaterThanOrEqual(120);
    }
    // The default 2.0 g/kg (240 g) fits, so nothing is capped.
    const byDefault = targetsForDate(
      { ...p, proteinSetting: undefined },
      "2026-10-20",
      FREE,
    );
    expect(byDefault.protein).toBe(240);
    expect(byDefault.training?.proteinCapped).toBe(false);
  });

  describe("floors hold across a grid of profiles and settings", () => {
    const ORDER = ["rest", "light", "training", "endurance", "heavy"];
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
                      const fatFloor = Math.max(
                        0.5 * weight,
                        ((goal === "lose" ? 0.15 : 0.2) * mean) / 9,
                      );
                      const wanted = round5(gPerKg * weight);
                      expect(new Set(days.map((d) => d.protein)).size).toBe(1);
                      for (const d of days) {
                        expect(d.fat).toBeGreaterThanOrEqual(fatFloor);
                        if (dietType !== "lowCarb") {
                          expect(d.carbs).toBeGreaterThanOrEqual(weight);
                        }
                        expect(d.training?.proteinCapped).toBe(
                          d.protein < wanted,
                        );
                        const kcal = 4 * (d.protein + d.carbs) + 9 * d.fat;
                        expect(
                          Math.abs(kcal - d.targetCalories),
                        ).toBeLessThanOrEqual(45);
                      }
                      // Same calories → carbs never fall as the class gets harder.
                      for (const a of days) {
                        for (const b of days) {
                          const rank = (d: typeof a) =>
                            ORDER.indexOf(d.training?.dayClass ?? "");
                          if (
                            dietType !== "lowCarb" &&
                            a.targetCalories === b.targetCalories &&
                            rank(a) < rank(b)
                          ) {
                            expect(b.carbs).toBeGreaterThanOrEqual(a.carbs);
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
