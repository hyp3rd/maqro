/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Meter, meterGeometry, meterReading, type MeterProps } from "./meter";

afterEach(() => cleanup());

const parts = (meter: HTMLElement) => ({
  fill: meter.querySelector<HTMLElement>("[data-part=fill]"),
  overflow: meter.querySelector<HTMLElement>("[data-part=overflow]"),
  tick: meter.querySelector<HTMLElement>("[data-part=target]"),
  track: meter.querySelector<HTMLElement>("[data-part=track]"),
});

const pct = (style: string | undefined) => Number.parseFloat(style ?? "NaN");

describe("meterGeometry", () => {
  it("leaves headroom past the target while under it", () => {
    const g = meterGeometry(80, 100);
    expect(g.tick).toBeCloseTo(83.333, 2);
    expect(g.fill).toBeCloseTo(66.667, 2);
    expect(g.overflow).toBe(0);
  });

  it("is exactly at the tick when on target, with no overflow", () => {
    const g = meterGeometry(100, 100);
    expect(g.tick).toBeCloseTo(83.333, 2);
    expect(g.fill).toBeCloseTo(83.333, 2);
    expect(g.overflow).toBe(0);
  });

  it("never clamps: 157% puts the tick at 1/1.57 and fills the rest as overflow", () => {
    const g = meterGeometry(157, 100);
    const tick = 100 / 1.57;
    expect(g.tick).toBeCloseTo(tick, 6);
    expect(g.fill).toBeCloseTo(tick, 6);
    expect(g.overflow).toBeCloseTo(100 - tick, 6);
    expect(g.fill + g.overflow).toBeCloseTo(100, 6);
  });

  it("keeps the headroom scale for a small overshoot (tick does not move)", () => {
    const g = meterGeometry(110, 100);
    expect(g.tick).toBeCloseTo(83.333, 2);
    expect(g.overflow).toBeCloseTo((10 / 120) * 100, 4);
  });

  it("draws nothing to measure against without a target", () => {
    expect(meterGeometry(500, 0)).toEqual({ tick: null, fill: 0, overflow: 0 });
    expect(meterGeometry(500, Number.NaN)).toEqual({
      tick: null,
      fill: 0,
      overflow: 0,
    });
  });

  it("treats negative or non-finite values as zero", () => {
    expect(meterGeometry(-20, 100).fill).toBe(0);
    expect(meterGeometry(Number.NaN, 100).fill).toBe(0);
  });
});

describe("Meter", () => {
  it("exposes value vs target as an ARIA meter", () => {
    render(
      <Meter
        aria-label="Protein"
        value={85}
        target={160}
        unit="g"
      />,
      { wrapper: intlWrapper() },
    );
    const meter = screen.getByRole("meter", { name: "Protein" });
    expect(meter.getAttribute("aria-valuenow")).toBe("85");
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("160");
    expect(meter.getAttribute("aria-valuetext")).toBe("85 g of 160 g");
  });

  it("keeps aria-valuenow within range when over target and says so calmly", () => {
    render(
      <Meter
        aria-label="Carbs"
        value={314}
        target={200}
        unit="g"
      />,
      { wrapper: intlWrapper() },
    );
    const meter = screen.getByRole("meter", { name: "Carbs" });
    // ARIA: valuenow must not exceed valuemax, so the max stretches to the
    // value instead of the value being clamped to the target.
    expect(meter.getAttribute("aria-valuenow")).toBe("314");
    expect(meter.getAttribute("aria-valuemax")).toBe("314");
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "314 g of 200 g, 114 g above target",
    );
  });

  it("renders the target tick and an overflow segment past it (157%)", () => {
    render(
      <Meter
        aria-label="Carbs"
        value={157}
        target={100}
        tone="carbs"
      />,
      { wrapper: intlWrapper() },
    );
    const { fill, overflow, tick, track } = parts(
      screen.getByRole("meter", { name: "Carbs" }),
    );
    expect(pct(tick?.style.left)).toBeCloseTo(100 / 1.57, 2);
    expect(pct(track?.style.width)).toBeCloseTo(100 / 1.57, 2);
    expect(pct(fill?.style.width)).toBeCloseTo(100 / 1.57, 2);
    expect(pct(overflow?.style.left)).toBeCloseTo(100 / 1.57, 2);
    expect(pct(overflow?.style.width)).toBeCloseTo(100 - 100 / 1.57, 2);
    // Same hue, lower intensity; never a warning colour.
    expect(fill?.className).toContain("bg-macro-carbs");
    expect(overflow?.className).toContain("bg-macro-carbs/40");
    const all = `${fill?.className} ${overflow?.className}`;
    expect(all).not.toMatch(/destructive|warning|red|amber|rose/);
  });

  it("has no overflow segment at or under target", () => {
    render(
      <Meter
        aria-label="Fat"
        value={60}
        target={60}
        tone="fat"
      />,
      { wrapper: intlWrapper() },
    );
    const { overflow, fill, tick } = parts(
      screen.getByRole("meter", { name: "Fat" }),
    );
    expect(overflow).toBeNull();
    expect(pct(fill?.style.width)).toBeCloseTo(pct(tick?.style.left), 6);
  });

  it("states the missing target instead of drawing a tick", () => {
    render(
      <Meter
        aria-label="Energy"
        value={1200}
        target={0}
        unit="kcal"
      />,
      { wrapper: intlWrapper() },
    );
    const meter = screen.getByRole("meter", { name: "Energy" });
    expect(parts(meter).tick).toBeNull();
    expect(meter.getAttribute("aria-valuemax")).toBe("1200");
    expect(meter.getAttribute("aria-valuetext")).toBe("1,200 kcal, no target");
  });

  it("formats the reading for the app locale", () => {
    render(
      <Meter
        aria-label="Energy"
        value={12345}
        target={20000}
        unit="kcal"
      />,
      { wrapper: intlWrapper("it") },
    );
    expect(
      screen
        .getByRole("meter", { name: "Energy" })
        .getAttribute("aria-valuetext"),
    ).toBe("12.345 kcal of 20.000 kcal");
  });

  it("formats figures with the caller's formatter at its precision", () => {
    render(
      <Meter
        aria-label="Protein"
        value={12.345}
        target={20}
        unit="g"
        format={(n) => n.toFixed(1)}
        decimals={1}
      />,
      { wrapper: intlWrapper() },
    );
    expect(
      screen
        .getByRole("meter", { name: "Protein" })
        .getAttribute("aria-valuetext"),
    ).toBe("12.3 g of 20.0 g");
  });

  const reading = (value: number, target: number, decimals?: 0 | 1 | 2) => {
    render(
      <Meter
        aria-label="Protein"
        value={value}
        target={target}
        unit="g"
        decimals={decimals}
      />,
      { wrapper: intlWrapper() },
    );
    return screen.getByRole("meter", { name: "Protein" });
  };

  it("takes the overshoot from the shown figures, not the raw ones", () => {
    // Raw 161.6 - 160.4 = 1.2 would read "+1"; the figures say 162 and
    // 160, so the reading says 2.
    const meter = reading(161.6, 160.4);
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "162 g of 160 g, 2 g above target",
    );
    expect(meter.getAttribute("aria-valuenow")).toBe("162");
    expect(meter.getAttribute("aria-valuemax")).toBe("162");
  });

  it("calls a figure over target whenever it shows above it", () => {
    // Raw 0.2 over, but 161 is shown against 160: one over, not silent.
    expect(reading(160.6, 160.4).getAttribute("aria-valuetext")).toBe(
      "161 g of 160 g, 1 g above target",
    );
  });

  it("is on target, with no overflow, when the figures are equal", () => {
    // Raw 160.45 is over 160.2, but both show as 160.
    const meter = reading(160.45, 160.2);
    expect(meter.getAttribute("aria-valuetext")).toBe("160 g of 160 g");
    expect(parts(meter).overflow).toBeNull();
  });

  it("rounds a fractional target at the given precision", () => {
    // 161.66 vs 160.34 shows 161.7 vs 160.3: 1.4 over (raw 1.32 says 1.3).
    expect(reading(161.66, 160.34, 1).getAttribute("aria-valuetext")).toBe(
      "161.7 g of 160.3 g, 1.4 g above target",
    );
  });

  it("has no target when the target rounds to zero", () => {
    expect(reading(85, 0.4).getAttribute("aria-valuetext")).toBe(
      "85 g, no target",
    );
  });
});

describe("meterReading", () => {
  it("accepts only the readout precisions", () => {
    // A precision outside what Intl.NumberFormat accepts would throw a
    // RangeError while the readout renders.
    expectTypeOf(meterReading).parameter(2).toEqualTypeOf<0 | 1 | 2>();
    expectTypeOf<MeterProps["decimals"]>().toEqualTypeOf<
      0 | 1 | 2 | undefined
    >();
  });

  it("rounds value and target before comparing them", () => {
    expect(meterReading(161.6, 160.4, 0)).toEqual({
      value: 162,
      target: 160,
      over: 2,
    });
    expect(meterReading(160.45, 160.2, 0)).toEqual({
      value: 160,
      target: 160,
      over: 0,
    });
    expect(meterReading(161.66, 160.34, 1)).toEqual({
      value: 161.7,
      target: 160.3,
      over: 1.4,
    });
  });

  it("has no target unless the target shows as a positive figure", () => {
    for (const target of [undefined, 0, -5, 0.4, Number.NaN]) {
      expect(meterReading(85, target, 0)).toEqual({
        value: 85,
        target: null,
        over: 0,
      });
    }
  });

  it("treats negative or non-finite values as zero", () => {
    expect(meterReading(-3, 100, 0).value).toBe(0);
    expect(meterReading(Number.NaN, 100, 0).value).toBe(0);
  });
});
