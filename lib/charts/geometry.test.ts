import { describe, expect, it } from "vitest";
import {
  type DayTick,
  dayIndexFromIsoDate,
  dayTicks,
  formatDayIndex,
  layoutBars,
  linearPath,
  monotonePath,
  niceStep,
  niceTicks,
  stepPath,
  xUnit,
} from "./geometry";

describe("dayIndexFromIsoDate", () => {
  it("names the calendar day, independent of the runtime timezone", () => {
    expect(dayIndexFromIsoDate("1970-01-01")).toBe(0);
    expect(dayIndexFromIsoDate("1970-01-02")).toBe(1);
    expect(dayIndexFromIsoDate("2026-10-23")).toBe(20_749);
    // Round-trips through the UTC formatter.
    expect(formatDayIndex(dayIndexFromIsoDate("2026-10-23"), "en-US")).toBe(
      "Oct 23",
    );
  });

  it("is consecutive across a DST change", () => {
    expect(
      dayIndexFromIsoDate("2026-03-30") - dayIndexFromIsoDate("2026-03-29"),
    ).toBe(1);
  });

  it("rejects a malformed key instead of plotting NaN", () => {
    expect(() => dayIndexFromIsoDate("2026-1-5")).toThrow(RangeError);
    expect(() => dayIndexFromIsoDate("")).toThrow(RangeError);
  });
});

describe("niceStep", () => {
  it.each([
    [0.07, 0.1],
    [0.13, 0.2],
    [0.21, 0.25],
    [0.3, 0.5],
    [186, 200],
    [240, 250],
    [251, 500],
    [600, 1000],
    [2.5, 2.5],
  ])("rounds %s up to %s", (raw, want) => {
    expect(niceStep(raw)).toBeCloseTo(want, 10);
  });
});

describe("niceTicks", () => {
  it("replaces the raw quartiles 1164/1350/1536... with round values", () => {
    const s = niceTicks(1200, 1870, 4);
    expect(s.ticks).toEqual([1200, 1400, 1600, 1800, 2000]);
    expect(s.min).toBe(1200);
    expect(s.max).toBe(2000);
    expect(s.decimals).toBe(0);
  });

  it("gives tenth-of-a-kilo ticks for a flat weight series", () => {
    const s = niceTicks(67.9, 68.4, 5);
    expect(s.ticks).toEqual([67.9, 68, 68.1, 68.2, 68.3, 68.4]);
    expect(s.decimals).toBe(1);
  });

  it("only ever uses 1 / 2 / 2.5 / 5 x 10^n steps", () => {
    for (const [lo, hi, n] of [
      [0, 7.3, 4],
      [3, 2700, 5],
      [0.12, 0.93, 3],
      [-40, 55, 4],
      [1744, 1744, 4],
    ] as const) {
      const { step, ticks, min, max } = niceTicks(lo, hi, n);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 2.5, 5]).toContainEqual(Number(mantissa.toFixed(6)));
      expect(ticks.length - 1).toBeLessThanOrEqual(n);
      expect(min).toBeLessThanOrEqual(Math.min(lo, hi));
      expect(max).toBeGreaterThanOrEqual(Math.max(lo, hi));
    }
  });

  it("widens a single value so it sits between gridlines", () => {
    const s = niceTicks(1744, 1744, 4);
    expect(s.min).toBeLessThan(1744);
    expect(s.max).toBeGreaterThan(1744);
  });

  it("prints 2.5-multiples with the digits they need", () => {
    expect(niceTicks(0, 1, 4).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0, 1, 4).decimals).toBe(2);
  });
});

describe("dayTicks", () => {
  const oct = (d: number) =>
    dayIndexFromIsoDate(`2026-10-${String(d).padStart(2, "0")}`);
  /** Accepts a step with at most `n` ticks. */
  const atMost = (n: number) => (t: readonly DayTick[]) => t.length <= n;

  it("labels every day when there is room", () => {
    const t = dayTicks(oct(1), oct(5), atMost(10), "en-US");
    expect(t.map((x) => x.label)).toEqual([
      "Oct 1",
      "Oct 2",
      "Oct 3",
      "Oct 4",
      "Oct 5",
    ]);
  });

  it("spaces ticks evenly in time (fixed day step), not by data index", () => {
    const t = dayTicks(oct(1), oct(10), atMost(4), "en-US");
    const gaps = t.slice(1).map((x, i) => x.day - (t[i]?.day ?? 0));
    expect(new Set(gaps).size).toBe(1);
    expect(t.length).toBeLessThanOrEqual(4);
  });

  it("falls back to Mondays for a month-long window", () => {
    // 2026-10-01 is a Thursday; Mondays are 5, 12, 19, 26.
    const t = dayTicks(oct(1), oct(30), atMost(5), "en-US");
    expect(t.map((x) => x.label)).toEqual([
      "Oct 5",
      "Oct 12",
      "Oct 19",
      "Oct 26",
    ]);
  });

  it("uses month starts for long ranges", () => {
    const t = dayTicks(
      dayIndexFromIsoDate("2026-01-10"),
      dayIndexFromIsoDate("2026-07-20"),
      atMost(7),
      "en-US",
    );
    expect(t.map((x) => x.label)).toEqual([
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
    ]);
  });

  it("never labels a month so it reads as a day across a year boundary", () => {
    // Weekly weigh-ins sliced to the last 60 entries span more than a year.
    const t = dayTicks(
      dayIndexFromIsoDate("2025-08-15"),
      dayIndexFromIsoDate("2026-10-15"),
      atMost(8),
      "en-US",
    );
    const labels = t.map((x) => x.label);
    // "Oct 25" would be read as the 25th of October.
    for (const l of labels) expect(l).not.toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    // Every other month, counted from January.
    expect(labels).toEqual(["Sep", "Nov", "2026", "Mar", "May", "Jul", "Sep"]);
    // ...and the year tick sits on January 1st.
    const year = t.find((x) => x.label === "2026");
    expect(year?.day).toBe(dayIndexFromIsoDate("2026-01-01"));
  });

  it("takes the finest step the caller says fits", () => {
    // Four Mondays fit a four-label budget...
    const weekly = dayTicks(oct(1), oct(30), atMost(4), "en-US");
    expect(weekly.map((x) => x.label)).toEqual([
      "Oct 5",
      "Oct 12",
      "Oct 19",
      "Oct 26",
    ]);
    // ...but a caller whose labels need 8 days of room rejects weekly
    // ticks, and gets the next step whose every tick has that room.
    const nov = (d: number) =>
      dayIndexFromIsoDate(`2026-11-${String(d).padStart(2, "0")}`);
    const seen: string[][] = [];
    const roomy = dayTicks(
      oct(1),
      nov(30),
      (t) => {
        seen.push(t.map((x) => x.label));
        return (
          t.length <= 10 &&
          t.every((x, i) => i === 0 || x.day - (t[i - 1]?.day ?? 0) >= 8)
        );
      },
      "en-US",
    );
    expect(roomy.map((x) => x.label)).toEqual([
      "Oct 5",
      "Oct 19",
      "Nov 2",
      "Nov 16",
      "Nov 30",
    ]);
    // The caller judges each step with the labels it would draw.
    expect(seen).toContainEqual([
      "Oct 5",
      "Oct 12",
      "Oct 19",
      "Oct 26",
      "Nov 2",
      "Nov 9",
      "Nov 16",
      "Nov 23",
      "Nov 30",
    ]);
  });

  it("labels both ends of a narrow axis instead of a lone calendar tick", () => {
    // Three labels fit, but no 1/2/3-day step does over Oct 1-10, and the
    // only Monday is Oct 5: one label, at neither end.
    expect(
      dayTicks(oct(1), oct(10), atMost(3), "en-US").map((x) => x.label),
    ).toEqual(["Oct 1", "Oct 10"]);
    // Evenly filled in between as far as the room allows: steps that
    // divide the 9-day span land on both ends.
    expect(
      dayTicks(oct(1), oct(10), atMost(4), "en-US").map((x) => x.label),
    ).toEqual(["Oct 1", "Oct 4", "Oct 7", "Oct 10"]);
    // Two Mondays (Oct 12, 19) fit, but say less than the range's ends.
    expect(
      dayTicks(oct(10), oct(23), atMost(2), "en-US").map((x) => x.label),
    ).toEqual(["Oct 10", "Oct 23"]);
    // A calendar step with three or more labels is kept.
    expect(
      dayTicks(oct(1), oct(30), atMost(5), "en-US").map((x) => x.label),
    ).toEqual(["Oct 5", "Oct 12", "Oct 19", "Oct 26"]);
  });

  it("keeps a calendar tick over a year or more, where day labels repeat", () => {
    // "Aug 15" ... "Oct 15" would not say which year.
    const t = dayTicks(
      dayIndexFromIsoDate("2025-08-15"),
      dayIndexFromIsoDate("2026-10-15"),
      atMost(2),
      "en-US",
    );
    expect(t.map((x) => x.label)).toEqual(["2026", "Jul"]);
  });

  it("labels the first day alone when nothing fits", () => {
    expect(dayTicks(oct(1), oct(30), () => false, "en-US")).toEqual([
      { day: oct(1), label: "Oct 1" },
    ]);
  });

  it("labels a single day", () => {
    expect(dayTicks(oct(9), oct(9), atMost(5), "en-US")).toEqual([
      { day: oct(9), label: "Oct 9" },
    ]);
  });
});

/** Parse "M x,y C x,y x,y x,y ..." into the cubic segments' y values. */
function cubicSegments(d: string) {
  const nums = (s: string) =>
    s
      .trim()
      .split(/[\s,]+/)
      .map(Number);
  const [move, ...curves] = d.split("C");
  const start = nums((move ?? "").replace("M", ""));
  let prevY = start[1] ?? 0;
  return curves.map((c) => {
    const [, c1y, , c2y, , y] = nums(c);
    const seg = { y0: prevY, c1y: c1y ?? 0, c2y: c2y ?? 0, y1: y ?? 0 };
    prevY = seg.y1;
    return seg;
  });
}

describe("monotonePath", () => {
  it("never overshoots: every control point stays inside its segment's range", () => {
    // The visual-audit shape: a dip day between two high days, plus a
    // plateau and a spike - Catmull-Rom dipped below the low and bulged
    // above the spike here.
    const pts = [10, 80, 75, 20, 22, 21, 90, 85, 30].map((y, i) => ({
      x: i * 40,
      y,
    }));
    const segments = cubicSegments(monotonePath(pts));
    expect(segments).toHaveLength(pts.length - 1);
    for (const s of segments) {
      const lo = Math.min(s.y0, s.y1) - 1e-6;
      const hi = Math.max(s.y0, s.y1) + 1e-6;
      for (const c of [s.c1y, s.c2y]) {
        expect(c).toBeGreaterThanOrEqual(lo);
        expect(c).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("keeps flat runs flat", () => {
    const segments = cubicSegments(
      monotonePath([
        { x: 0, y: 50 },
        { x: 10, y: 50 },
        { x: 20, y: 50 },
      ]),
    );
    for (const s of segments) expect([s.c1y, s.c2y]).toEqual([50, 50]);
  });

  it("falls back to straight segments under three points", () => {
    const two = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ];
    expect(monotonePath(two)).toBe(linearPath(two));
  });
});

describe("stepPath", () => {
  it("holds each level across its slot and steps at the midpoint", () => {
    const d = stepPath(
      [
        { x: 10, y: 100 },
        { x: 30, y: 80 },
        { x: 50, y: 80 },
      ],
      { left: 0, right: 60 },
    );
    expect(d).toBe("M0,100 L20,100 L20,80 L40,80 L40,80 L60,80");
  });

  it("draws a single target across the bounds", () => {
    expect(stepPath([{ x: 25, y: 40 }], { left: 0, right: 50 })).toBe(
      "M0,40 L50,40",
    );
  });

  it("is empty without points", () => {
    expect(stepPath([], { left: 0, right: 10 })).toBe("");
  });
});

describe("layoutBars", () => {
  // y: 0 -> 200px (baseline), 2000 -> 0px.
  const yToPx = (v: number) => 200 - v / 10;
  const opts = { left: 40, width: 300, yToPx, baselinePx: 200 };

  it("gives one slot per day, so unlogged days stay as gaps", () => {
    const { slotWidth, bars } = layoutBars(
      [
        { x: 100, value: 1500 },
        { x: 101, value: 1600 },
        { x: 104, value: 1700 },
      ],
      opts,
    );
    expect(slotWidth).toBe(60); // 5 slots over 300px
    expect(bars.map((b) => b.cx)).toEqual([70, 130, 310]);
    expect(bars[0]?.width).toBe(24); // 60% of 60 = 36, capped at 24
  });

  it("keeps the skipped days of an every-other-day log when given the day unit", () => {
    const everyOtherDay = [
      { x: 100, value: 1500 },
      { x: 102, value: 1600 },
      { x: 104, value: 1700 },
    ];
    // Inferred from the data, a slot spans two days and the gaps vanish.
    expect(layoutBars(everyOtherDay, opts).slotWidth).toBe(100);
    // With the axis unit, five day slots: the 101 and 103 slots stay empty.
    const { slotWidth, bars } = layoutBars(everyOtherDay, { ...opts, unit: 1 });
    expect(slotWidth).toBe(60);
    expect(bars.map((b) => b.cx)).toEqual([70, 190, 310]);
  });

  it("splits a bar at its target: solid to the target, calm overshoot above", () => {
    const { bars } = layoutBars(
      [
        { x: 1, value: 2060, target: 1950 },
        { x: 2, value: 1800, target: 1950 },
      ],
      opts,
    );
    const [over, under] = bars;
    expect(over?.base).toEqual({ top: 5, bottom: 200 });
    expect(over?.over?.top).toBeCloseTo(-6);
    expect(over?.over?.bottom).toBe(5);
    expect(over?.over?.amount).toBe(110);
    expect(under?.base).toEqual({ top: 20, bottom: 200 });
    expect(under?.over).toBeUndefined();
  });

  it("draws a whole bar when there is no target", () => {
    const { bars } = layoutBars([{ x: 0, value: 1000 }], opts);
    expect(bars[0]?.base).toEqual({ top: 100, bottom: 200 });
    expect(bars[0]?.over).toBeUndefined();
    expect(bars[0]?.cx).toBe(190); // a lone bar centres in the plot
  });

  it("infers the slot unit from the data", () => {
    expect(xUnit([0, 7, 14, 28])).toBe(7);
    expect(xUnit([5])).toBe(1);
  });
});
