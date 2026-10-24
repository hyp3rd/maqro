import { formatNumber } from "@/lib/i18n/number";
import { describe, expect, it } from "vitest";
import type { Meal } from "@maqro/core/types";
import {
  DAY_MINUTES,
  elapsedMinutes,
  formatClock,
  hourLabels,
  labelAnchor,
  localDate,
  mealStartMinute,
  mealTicks,
  minuteOfDay,
  parseClock,
  relativeDay,
  timelineSummary,
  trackPercent,
  workoutSpan,
} from "./timeline";

const DAY = "2026-10-21";
/** Local wall-clock instant on DAY (or another day) — never a UTC literal,
 *  so the tests hold in every timezone. */
const at = (h: number, m: number, day = 21) =>
  new Date(2026, 9, day, h, m).getTime();

const food = (calories: number, loggedAt?: number) => ({
  id: Math.round(calories * 1000 + (loggedAt ?? 0) / 60000),
  name: "food",
  protein: 0,
  carbs: 0,
  fat: 0,
  calories,
  portionSize: 100,
  ...(loggedAt === undefined ? {} : { loggedAt }),
});

describe("clock helpers", () => {
  it("parses and formats 24 h HH:MM", () => {
    expect(parseClock("18:00")).toBe(1080);
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("23:59")).toBe(1439);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("7:30")).toBeNull();
    expect(parseClock(undefined)).toBeNull();
    expect(formatClock(1080)).toBe("18:00");
    expect(formatClock(450)).toBe("07:30");
    expect(formatClock(DAY_MINUTES)).toBe("24:00");
  });

  it("reads an instant's local wall-clock minute when it falls on the day", () => {
    expect(minuteOfDay(at(12, 15), DAY)).toBe(735);
    expect(minuteOfDay(at(0, 0), DAY)).toBe(0);
    expect(minuteOfDay(at(23, 59), DAY)).toBe(1439);
    // Another calendar day stays off this day's track.
    expect(minuteOfDay(at(0, 30, 22), DAY)).toBeNull();
    expect(minuteOfDay(at(23, 30, 20), DAY)).toBeNull();
    expect(minuteOfDay(Number.NaN, DAY)).toBeNull();
  });

  it("uses the wall clock on a daylight-saving day (23 h long)", () => {
    // 29 Mar 2026 springs forward in the EU; wherever the tests run, a
    // local 14:00 is minute 840 of the track, not 14 h after midnight.
    const dst = new Date(2026, 2, 29, 14, 0).getTime();
    expect(minuteOfDay(dst, "2026-03-29")).toBe(840);
  });

  it("maps minutes onto the track as a percentage, clamped", () => {
    expect(trackPercent(0)).toBe(0);
    expect(trackPercent(720)).toBe(50);
    expect(trackPercent(DAY_MINUTES)).toBe(100);
    expect(trackPercent(-10)).toBe(0);
    expect(trackPercent(5000)).toBe(100);
  });
});

describe("localDate", () => {
  it("is local midnight of the key's calendar day", () => {
    const d = localDate("2026-03-29");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2026, 2, 29, 0,
    ]);
  });

  it("is an invalid date for a key that isn't one", () => {
    expect(Number.isNaN(localDate("").getTime())).toBe(true);
  });
});

describe("relativeDay and elapsedMinutes", () => {
  it("orders date keys against today", () => {
    expect(relativeDay("2026-10-20", DAY)).toBe("past");
    expect(relativeDay(DAY, DAY)).toBe("today");
    expect(relativeDay("2026-10-22", DAY)).toBe("future");
  });

  it("lights the part of today that has passed; all of a past day; none of a future one", () => {
    expect(elapsedMinutes(DAY, DAY, at(15, 10))).toBe(910);
    expect(elapsedMinutes("2026-10-20", DAY, at(15, 10))).toBe(DAY_MINUTES);
    expect(elapsedMinutes("2026-10-22", DAY, at(15, 10))).toBe(0);
    // Clock not known yet (server snapshot): nothing lit.
    expect(elapsedMinutes(DAY, DAY, 0)).toBe(0);
  });
});

describe("mealTicks", () => {
  const meals: Meal[] = [
    {
      id: 1,
      name: "Breakfast",
      foods: [food(300, at(7, 40)), food(220, at(7, 30))],
    },
    { id: 2, name: "Lunch", foods: [food(720, at(12, 45))] },
    // Planned / copied without a time: stays off the track.
    { id: 3, name: "Dinner", foods: [food(650)] },
    { id: 4, name: "Snacks", foods: [] },
  ];

  it("places each meal at its earliest logged food with the whole meal's kcal", () => {
    const ticks = mealTicks(meals, DAY);
    expect(
      ticks.map(({ name, minutes, kcal }) => ({ name, minutes, kcal })),
    ).toEqual([
      { name: "Breakfast", minutes: 450, kcal: 520 },
      { name: "Lunch", minutes: 765, kcal: 720 },
    ]);
  });

  it("reads a meal's start minute (or none) for the rail", () => {
    expect(mealStartMinute(meals[0] as Meal, DAY)).toBe(450);
    expect(mealStartMinute(meals[2] as Meal, DAY)).toBeNull();
    expect(mealStartMinute(meals[3] as Meal, DAY)).toBeNull();
  });

  it("sorts by time and lifts a label that would collide into the second lane", () => {
    const close: Meal[] = [
      { id: 4, name: "Snacks", foods: [food(150, at(13, 30))] },
      { id: 2, name: "Lunch", foods: [food(600, at(12, 45))] },
      { id: 3, name: "Dinner", foods: [food(700, at(19, 0))] },
    ];
    const ticks = mealTicks(close, DAY);
    expect(ticks.map((t) => [t.name, t.lane])).toEqual([
      ["Lunch", 0],
      ["Snacks", 1],
      ["Dinner", 0],
    ]);
  });

  it("gives wider labels more room and leaves off one that has no lane", () => {
    // Three 1,340 kcal meals 40 minutes apart: lane 0, lane 1, then no
    // lane clear of both (the old placement printed it over the first).
    const crowded: Meal[] = [
      { id: 1, name: "Breakfast", foods: [food(1340, at(12, 0))] },
      { id: 2, name: "Lunch", foods: [food(1340, at(12, 40))] },
      { id: 3, name: "Dinner", foods: [food(1340, at(13, 20))] },
      { id: 4, name: "Snacks", foods: [food(1340, at(16, 0))] },
    ];
    expect(mealTicks(crowded, DAY).map((t) => [t.name, t.lane])).toEqual([
      ["Breakfast", 0],
      ["Lunch", 1],
      ["Dinner", null],
      ["Snacks", 0],
    ]);
    // 150 minutes clears two 3-digit labels but not two 5-character ones.
    const apart = (kcal: number): Meal[] => [
      { id: 1, name: "Breakfast", foods: [food(kcal, at(8, 0))] },
      { id: 2, name: "Lunch", foods: [food(kcal, at(10, 30))] },
    ];
    expect(mealTicks(apart(720), DAY).map((t) => t.lane)).toEqual([0, 0]);
    expect(mealTicks(apart(1340), DAY).map((t) => t.lane)).toEqual([0, 1]);
  });

  it("keeps a character's gap between two labels in one lane", () => {
    // 2 h 13 min apart, "1,821" then "437": on a 320px phone's track the
    // two would sit ~3px apart and read as one figure ("1,821 437").
    const near: Meal[] = [
      { id: 1, name: "Lunch", foods: [food(1821, at(12, 0))] },
      { id: 2, name: "Snacks", foods: [food(437, at(14, 13))] },
    ];
    expect(mealTicks(near, DAY).map((t) => t.lane)).toEqual([0, 1]);
  });

  it("measures a label at a track end from the end it is anchored to", () => {
    // The late label is anchored to the track's right end, so it reaches
    // further left than a centred one would: it lands on Dinner's label.
    const late: Meal[] = [
      { id: 1, name: "Dinner", foods: [food(720, at(20, 0))] },
      { id: 2, name: "Snacks", foods: [food(1050, at(23, 15))] },
    ];
    expect(labelAnchor(23 * 60 + 15)).toBe("end");
    expect(mealTicks(late, DAY).map((t) => t.lane)).toEqual([0, 1]);
  });
});

describe("workoutSpan", () => {
  it("is the planned session from its start for its duration", () => {
    expect(
      workoutSpan(
        { type: "lower", intensity: "hard", time: "18:00", durationMin: 75 },
        "Lower · heavy day",
      ),
    ).toEqual({
      kind: "workout",
      startMin: 1080,
      endMin: 1155,
      label: "Lower · heavy day",
    });
  });

  it("ends at midnight rather than wrapping into tomorrow", () => {
    expect(
      workoutSpan({ type: "sport", time: "23:00", durationMin: 120 }, "Sport")
        ?.endMin,
    ).toBe(DAY_MINUTES);
  });

  it("marks a session with no duration as a point at its start", () => {
    const span = workoutSpan({ type: "upper", time: "06:30" }, "Upper");
    expect(span).toMatchObject({ startMin: 390, endMin: 390 });
  });

  it("is absent for a rest day, an unknown time or no session", () => {
    expect(workoutSpan({ type: "rest", time: "18:00" }, "Rest day")).toBeNull();
    expect(workoutSpan({ type: "upper" }, "Upper")).toBeNull();
    expect(workoutSpan(undefined, "")).toBeNull();
  });
});

describe("labels", () => {
  it("keeps the hour marks clear of the now flag", () => {
    expect(hourLabels(null)).toEqual([0, 6, 12, 18, 24]);
    // 15:10: 12 and 18 would sit under "Now 15:10".
    expect(hourLabels(910)).toEqual([0, 6, 24]);
    expect(hourLabels(60)).toEqual([6, 12, 18, 24]);
  });

  it("anchors a label inside the track near its ends", () => {
    expect(labelAnchor(30)).toBe("start");
    expect(labelAnchor(720)).toBe("middle");
    expect(labelAnchor(1420)).toBe("end");
  });

  it("summarises the day for assistive tech", () => {
    expect(
      timelineSummary({
        ticks: [
          { mealId: 1, name: "Breakfast", minutes: 450, kcal: 520, lane: 0 },
        ],
        spans: [
          {
            kind: "workout",
            startMin: 1080,
            endMin: 1155,
            label: "Lower · heavy day",
          },
        ],
        nowMinute: 910,
        formatKcal: String,
      }),
    ).toBe(
      "Breakfast at 07:30, 520 kcal. Workout, Lower · heavy day, 18:00 to 19:15. Now 15:10.",
    );
    expect(
      timelineSummary({
        ticks: [],
        spans: [],
        nowMinute: null,
        formatKcal: String,
      }),
    ).toBe("No timed meals yet.");
  });

  it("prints kcal through the caller's locale formatter", () => {
    expect(
      timelineSummary({
        ticks: [
          { mealId: 1, name: "Lunch", minutes: 765, kcal: 1050, lane: 0 },
        ],
        spans: [],
        nowMinute: null,
        formatKcal: (n) => formatNumber(n, "en"),
      }),
    ).toBe("Lunch at 12:45, 1,050 kcal.");
  });
});
