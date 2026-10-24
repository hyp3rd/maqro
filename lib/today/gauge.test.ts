import { describe, expect, it } from "vitest";
import {
  BEZEL,
  ENERGY_RING,
  GAUGE_CENTER,
  bezelDash,
  circumference,
  gaugeCenter,
  quarterMarksPath,
  ringArc,
  ringStrokes,
  targetIndexPath,
} from "./gauge";

describe("ringArc", () => {
  const C = circumference(ENERGY_RING.radius);

  it("draws eaten against the day's own target as a share of one lap", () => {
    // The design's 1,240 of 2,500 kcal: 274.25 of a 552.92 ring.
    const arc = ringArc(1240, 2500, ENERGY_RING.radius);
    expect(arc.circumference).toBeCloseTo(552.92, 2);
    expect(arc.fill).toBeCloseTo(274.25, 2);
    expect(arc.over).toBe(0);
  });

  it("fills exactly one lap at the target, with no overshoot", () => {
    const arc = ringArc(2500, 2500, ENERGY_RING.radius);
    expect(arc.fill).toBeCloseTo(C, 6);
    expect(arc.over).toBe(0);
  });

  it("continues past the index for an overshoot, never clamping it away", () => {
    // 15% over: a full lap plus 15% of a lap past 12 o'clock.
    const arc = ringArc(2875, 2500, ENERGY_RING.radius);
    expect(arc.fill).toBeCloseTo(C, 6);
    expect(arc.over).toBeCloseTo(0.15 * C, 6);
  });

  it("caps the overshoot at one more lap", () => {
    const arc = ringArc(9000, 2500, ENERGY_RING.radius);
    expect(arc.over).toBeCloseTo(C, 6);
  });

  it("draws nothing without a positive target or for a non-figure", () => {
    expect(ringArc(1200, 0, 88)).toMatchObject({ fill: 0, over: 0 });
    expect(ringArc(1200, Number.NaN, 88)).toMatchObject({ fill: 0, over: 0 });
    expect(ringArc(Number.NaN, 2000, 88)).toMatchObject({ fill: 0, over: 0 });
    expect(ringArc(-50, 2000, 88)).toMatchObject({ fill: 0, over: 0 });
  });
});

describe("ringStrokes", () => {
  const C = circumference(ENERGY_RING.radius);
  const parse = (d: string) => d.split(" ").map(Number);

  it("under target: one solid arc from 12 o'clock, no overshoot stroke", () => {
    const s = ringStrokes(ringArc(1240, 2500, ENERGY_RING.radius));
    expect(parse(s.solid.dashArray)[0]).toBeCloseTo(274.25, 2);
    expect(s.solid.dashOffset).toBe(0);
    expect(s.over).toBeNull();
  });

  it("over target: the overshoot from the index on, the solid arc on the rest of the lap", () => {
    const s = ringStrokes(ringArc(2875, 2500, ENERGY_RING.radius));
    const over = 0.15 * C;
    expect(parse(s.over?.dashArray ?? "")[0]).toBeCloseTo(over, 2);
    expect(s.over?.dashOffset).toBe(0);
    // The solid arc starts where the overshoot ends and closes the lap at
    // the index.
    expect(parse(s.solid.dashArray)[0]).toBeCloseTo(C - over, 2);
    expect(s.solid.dashOffset).toBeCloseTo(-over, 2);
  });
});

describe("bezel and index", () => {
  it("splits the bezel into 60 ticks, the first centred on 12 o'clock", () => {
    const { dashArray, dashOffset } = bezelDash();
    const [dash, gap] = dashArray.split(" ").map(Number);
    const period = circumference(BEZEL.radius) / 60;
    expect(dash).toBeCloseTo(BEZEL.tickLength, 6);
    expect((dash ?? 0) + (gap ?? 0)).toBeCloseTo(period, 2);
    expect(dashOffset).toBeCloseTo(BEZEL.tickLength / 2, 6);
  });

  it("puts the target index at 12 o'clock, crossing the energy ring", () => {
    const d = targetIndexPath();
    const match = /^M(\S+) (\S+)V(\S+)$/.exec(d);
    expect(match).not.toBeNull();
    const [, x, y1, y2] = match ?? [];
    expect(Number(x)).toBe(GAUGE_CENTER);
    // From the bezel's outer edge down past the energy ring's inner edge.
    expect(Number(y1)).toBeLessThanOrEqual(
      GAUGE_CENTER - BEZEL.radius - BEZEL.width / 2 + 1,
    );
    expect(Number(y2)).toBeGreaterThanOrEqual(
      GAUGE_CENTER - ENERGY_RING.radius + ENERGY_RING.width / 2,
    );
  });

  it("marks the other three quarters on the bezel", () => {
    const d = quarterMarksPath();
    // 3, 6 and 9 o'clock — 12 o'clock carries the target index instead.
    expect(d.match(/M/g)).toHaveLength(3);
    expect(d).toContain(`M${GAUGE_CENTER} `);
  });
});

describe("gaugeCenter", () => {
  it("says what is left, worded for the day", () => {
    expect(gaugeCenter(1240, 2500, "today")).toEqual({
      figure: 1260,
      label: "kcal left today",
    });
    expect(gaugeCenter(1240, 2500, "past")).toEqual({
      figure: 1260,
      label: "kcal under target",
    });
    expect(gaugeCenter(1240, 2500, "future")).toEqual({
      figure: 1260,
      label: "kcal to plan",
    });
  });

  it("states an overshoot as a neutral 'over', never as a warning", () => {
    expect(gaugeCenter(2610, 2500, "today")).toEqual({
      figure: 110,
      label: "kcal over",
    });
  });

  it("says when the day's target is reached exactly", () => {
    expect(gaugeCenter(2500.2, 2499.8, "today")).toEqual({
      figure: null,
      label: "Daily target reached",
    });
  });

  it("shows the target on a day with nothing logged yet", () => {
    expect(gaugeCenter(0, 2500, "today")).toEqual({
      figure: 2500,
      label: "kcal target",
    });
  });

  it("shows what was eaten when there is no target yet", () => {
    expect(gaugeCenter(830, 0, "today")).toEqual({
      figure: 830,
      label: "kcal eaten",
    });
  });
});
