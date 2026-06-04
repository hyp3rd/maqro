import type { GoalPhase, PersonalInfo } from "@/components/macro/types";
import { describe, expect, it } from "vitest";
import {
  activePhase,
  dietBreakNudge,
  effectiveGoal,
  nextPhase,
  normalizePhase,
  phaseEndDate,
  phaseGoal,
  phaseHasRate,
  phaseProgress,
  presetCut,
  presetCutThenBreak,
  presetLeanBulk,
} from "./goal-phases";

function phase(over: Partial<GoalPhase> & { id: string }): GoalPhase {
  return {
    kind: "cut",
    startDate: "2026-06-01",
    durationWeeks: 4,
    weeklyRateKg: 0.4,
    ...over,
  };
}

function profile(over: Partial<PersonalInfo>): PersonalInfo {
  return {
    gender: "female",
    age: 30,
    weight: 68,
    height: 168,
    activityLevel: "moderate",
    goal: "maintain",
    dietType: "balanced",
    dietPreference: "omnivore",
    cuisinePreferences: [],
    allergies: [],
    dislikedFoods: [],
    weeklyRateKg: 0,
    units: "metric",
    ...over,
  };
}

describe("phaseGoal / phaseHasRate", () => {
  it("maps kinds to a goal direction", () => {
    expect(phaseGoal("cut")).toBe("lose");
    expect(phaseGoal("leanBulk")).toBe("gain");
    expect(phaseGoal("maintenance")).toBe("maintain");
    expect(phaseGoal("dietBreak")).toBe("maintain");
  });

  it("only cut + lean bulk carry a rate", () => {
    expect(phaseHasRate("cut")).toBe(true);
    expect(phaseHasRate("leanBulk")).toBe(true);
    expect(phaseHasRate("maintenance")).toBe(false);
    expect(phaseHasRate("dietBreak")).toBe(false);
  });
});

describe("phaseEndDate", () => {
  it("is start + durationWeeks*7 days", () => {
    expect(
      phaseEndDate(
        phase({ id: "a", startDate: "2026-06-01", durationWeeks: 4 }),
      ),
    ).toBe("2026-06-29");
  });
});

describe("activePhase", () => {
  const cut = phase({ id: "cut", startDate: "2026-06-01", durationWeeks: 4 }); // → 06-29
  const brk = phase({
    id: "brk",
    kind: "dietBreak",
    startDate: "2026-06-29",
    durationWeeks: 2,
  }); // → 07-13

  it("finds the phase whose window contains today (start-inclusive, end-exclusive)", () => {
    expect(activePhase([cut, brk], "2026-06-04")?.id).toBe("cut");
    expect(activePhase([cut, brk], "2026-06-01")?.id).toBe("cut"); // start day
    expect(activePhase([cut, brk], "2026-06-29")?.id).toBe("brk"); // cut end = break start
    expect(activePhase([cut, brk], "2026-07-10")?.id).toBe("brk");
  });

  it("is null before, in a gap, and after the plan", () => {
    expect(activePhase([cut, brk], "2026-05-31")).toBeNull();
    expect(activePhase([cut, brk], "2026-07-13")).toBeNull(); // break end (exclusive)
    expect(activePhase([cut, brk], "2026-08-01")).toBeNull();
    expect(activePhase(undefined, "2026-06-04")).toBeNull();
  });

  it("prefers the latest-starting phase on overlap", () => {
    const a = phase({ id: "a", startDate: "2026-06-01", durationWeeks: 8 });
    const b = phase({ id: "b", startDate: "2026-06-15", durationWeeks: 8 });
    expect(activePhase([a, b], "2026-06-20")?.id).toBe("b");
  });
});

describe("nextPhase", () => {
  it("returns the soonest phase starting after today", () => {
    const cut = phase({ id: "cut", startDate: "2026-06-01" });
    const brk = phase({ id: "brk", startDate: "2026-06-29" });
    expect(nextPhase([cut, brk], "2026-06-10")?.id).toBe("brk");
    expect(nextPhase([cut, brk], "2026-07-01")).toBeNull();
  });
});

describe("effectiveGoal", () => {
  const cut = phase({
    id: "cut",
    kind: "cut",
    startDate: "2026-06-01",
    durationWeeks: 4,
    weeklyRateKg: 0.4,
  });
  const p = profile({ goal: "maintain", weeklyRateKg: 0, goalPhases: [cut] });

  it("uses the active phase's goal+rate when Pro", () => {
    const e = effectiveGoal(p, "2026-06-04", { phasesEnabled: true });
    expect(e.goal).toBe("lose");
    expect(e.weeklyRateKg).toBe(0.4);
    expect(e.phase?.id).toBe("cut");
  });

  it("falls back to the linear goal for free / disabled", () => {
    const e = effectiveGoal(p, "2026-06-04", { phasesEnabled: false });
    expect(e.goal).toBe("maintain");
    expect(e.weeklyRateKg).toBe(0);
    expect(e.phase).toBeNull();
  });

  it("falls back to linear when Pro but no phase covers today", () => {
    const e = effectiveGoal(p, "2026-05-01", { phasesEnabled: true });
    expect(e.goal).toBe("maintain");
    expect(e.phase).toBeNull();
  });

  it("zeroes the rate for a maintenance/diet-break phase", () => {
    const brk = phase({
      id: "brk",
      kind: "dietBreak",
      startDate: "2026-06-01",
      durationWeeks: 2,
      weeklyRateKg: 0.5,
    });
    const e = effectiveGoal(profile({ goalPhases: [brk] }), "2026-06-03", {
      phasesEnabled: true,
    });
    expect(e.goal).toBe("maintain");
    expect(e.weeklyRateKg).toBe(0);
  });
});

describe("phaseProgress", () => {
  it("reports week-of, elapsed, remaining, and fraction", () => {
    const pr = phaseProgress(
      phase({ id: "a", startDate: "2026-06-01", durationWeeks: 4 }),
      "2026-06-15",
    );
    expect(pr.daysElapsed).toBe(14);
    expect(pr.weekOf).toBe(3); // floor(14/7)+1
    expect(pr.totalWeeks).toBe(4);
    expect(pr.daysRemaining).toBe(14);
    expect(pr.pct).toBeCloseTo(0.5, 5);
  });

  it("clamps to the phase window", () => {
    const p = phase({ id: "a", startDate: "2026-06-01", durationWeeks: 2 });
    expect(phaseProgress(p, "2026-07-01").daysRemaining).toBe(0);
    expect(phaseProgress(p, "2026-07-01").pct).toBe(1);
  });
});

describe("dietBreakNudge", () => {
  it("suggests a break once a cut has run ≥10 weeks", () => {
    const cut = phase({
      id: "cut",
      kind: "cut",
      startDate: "2026-04-01",
      durationWeeks: 16,
    });
    expect(dietBreakNudge([cut], "2026-06-24")).toMatch(/diet break/i); // ~12 weeks in
  });

  it("is null for a short cut and for non-cut phases", () => {
    const shortCut = phase({
      id: "c",
      kind: "cut",
      startDate: "2026-06-01",
      durationWeeks: 12,
    });
    expect(dietBreakNudge([shortCut], "2026-06-15")).toBeNull(); // 2 weeks in
    const maint = phase({
      id: "m",
      kind: "maintenance",
      startDate: "2026-01-01",
      durationWeeks: 52,
    });
    expect(dietBreakNudge([maint], "2026-06-24")).toBeNull();
  });
});

describe("normalizePhase", () => {
  it("clamps duration to [1,52] and rate to the 1% cap", () => {
    const n = normalizePhase(
      phase({ id: "a", kind: "cut", durationWeeks: 100, weeklyRateKg: 5 }),
      68,
    );
    expect(n.durationWeeks).toBe(52);
    expect(n.weeklyRateKg).toBeCloseTo(0.68, 5); // 68 * 0.01
  });

  it("forces rate to 0 for non-cut/bulk kinds", () => {
    const n = normalizePhase(
      phase({ id: "a", kind: "maintenance", weeklyRateKg: 0.5 }),
      68,
    );
    expect(n.weeklyRateKg).toBe(0);
  });
});

describe("presets", () => {
  it("presetCut → one 12-week cut at a capped rate", () => {
    const [p] = presetCut("2026-06-04", 68);
    expect(p.kind).toBe("cut");
    expect(p.startDate).toBe("2026-06-04");
    expect(p.durationWeeks).toBe(12);
    expect(p.weeklyRateKg).toBeLessThanOrEqual(68 * 0.01);
    expect(p.weeklyRateKg).toBeGreaterThan(0);
  });

  it("presetCutThenBreak → cut then a break starting at the cut's end", () => {
    const phases = presetCutThenBreak("2026-06-04", 68);
    expect(phases).toHaveLength(2);
    expect(phases[0].kind).toBe("cut");
    expect(phases[1].kind).toBe("dietBreak");
    expect(phases[1].startDate).toBe(phaseEndDate(phases[0]));
    expect(phases[1].weeklyRateKg).toBe(0);
  });

  it("presetLeanBulk → one lean-bulk phase", () => {
    const [p] = presetLeanBulk("2026-06-04", 68);
    expect(p.kind).toBe("leanBulk");
    expect(p.weeklyRateKg).toBeGreaterThan(0);
  });
});
