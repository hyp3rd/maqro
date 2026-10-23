/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Meter, meterGeometry } from "./meter";

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

  it("formats figures with the caller's formatter", () => {
    render(
      <Meter
        aria-label="Protein"
        value={12.345}
        target={20}
        unit="g"
        format={(n) => n.toFixed(1)}
      />,
      { wrapper: intlWrapper() },
    );
    expect(
      screen
        .getByRole("meter", { name: "Protein" })
        .getAttribute("aria-valuetext"),
    ).toBe("12.3 g of 20.0 g");
  });

  it("does not speak an overshoot that formats to zero", () => {
    // 160.6 vs 160.4 both round to 160: the screen shows no "+N", so the
    // reading must not announce "0 g above target" either.
    render(
      <Meter
        aria-label="Protein"
        value={160.6}
        target={160.4}
        unit="g"
      />,
      { wrapper: intlWrapper() },
    );
    expect(
      screen
        .getByRole("meter", { name: "Protein" })
        .getAttribute("aria-valuetext"),
    ).toBe("161 g of 160 g");
  });

  it("speaks the smallest overshoot the formatter can show", () => {
    render(
      <Meter
        aria-label="Protein"
        value={161.6}
        target={160.4}
        unit="g"
      />,
      { wrapper: intlWrapper() },
    );
    expect(
      screen
        .getByRole("meter", { name: "Protein" })
        .getAttribute("aria-valuetext"),
    ).toBe("162 g of 160 g, 1 g above target");
  });
});
