import { describe, expect, it } from "vitest";
import type { Supplement, SupplementIntake } from "@maqro/core/records";
import {
  scheduleFiresAt,
  supplementMicrosForDay,
  supplementsById,
} from "./supplements";

function supp(over: Partial<Supplement> & { id: string }): Supplement {
  return {
    name: "Test",
    doseLabel: "1 capsule",
    micros: {},
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function intake(taken: SupplementIntake["taken"]): SupplementIntake {
  return { date: "2026-06-01", taken, recordedAt: 0 };
}

describe("supplementMicrosForDay", () => {
  const d3 = supp({ id: "d3", micros: { vitaminD: 25 } });
  const mag = supp({ id: "mag", micros: { iron: 8, magnesium: 100 } });
  const byId = supplementsById([d3, mag]);

  it("is empty for no intake", () => {
    expect(supplementMicrosForDay(undefined, byId)).toEqual({});
  });

  it("sums per-dose micros across taken supplements, scaled by doses", () => {
    const out = supplementMicrosForDay(
      intake([
        { supplementId: "d3", doses: 2 },
        { supplementId: "mag", doses: 1 },
      ]),
      byId,
    );
    expect(out).toEqual({ vitaminD: 50, iron: 8, magnesium: 100 });
  });

  it("skips unknown ids and non-positive doses", () => {
    const out = supplementMicrosForDay(
      intake([
        { supplementId: "ghost", doses: 3 },
        { supplementId: "d3", doses: 0 },
        { supplementId: "mag", doses: 1 },
      ]),
      byId,
    );
    expect(out).toEqual({ iron: 8, magnesium: 100 });
  });

  it("accumulates the same nutrient from multiple supplements", () => {
    const a = supp({ id: "a", micros: { iron: 5 } });
    const b = supp({ id: "b", micros: { iron: 3 } });
    const out = supplementMicrosForDay(
      intake([
        { supplementId: "a", doses: 1 },
        { supplementId: "b", doses: 2 },
      ]),
      supplementsById([a, b]),
    );
    expect(out).toEqual({ iron: 11 }); // 5 + 3*2
  });
});

describe("scheduleFiresAt", () => {
  it("is false with no schedule", () => {
    expect(scheduleFiresAt(undefined, 8, 1)).toBe(false);
  });

  it("fires only when the hour AND weekday both match", () => {
    const schedule = { reminderTimes: [8, 18], daysOfWeek: [1, 2, 3, 4, 5] };
    expect(scheduleFiresAt(schedule, 8, 1)).toBe(true); // 8am Monday
    expect(scheduleFiresAt(schedule, 18, 5)).toBe(true); // 6pm Friday
    expect(scheduleFiresAt(schedule, 8, 0)).toBe(false); // Sunday excluded
    expect(scheduleFiresAt(schedule, 9, 1)).toBe(false); // 9am not a time
  });
});
