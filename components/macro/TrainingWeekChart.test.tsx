/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { type ChartDay, TrainingWeekChart } from "./TrainingWeekChart";

/** jsdom has no ResizeObserver: capture instances, deliver widths by hand. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    FakeResizeObserver.all.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function resizeTo(width: number) {
  act(() => {
    for (const o of FakeResizeObserver.all) {
      o.callback(
        [
          {
            contentBoxSize: [{ inlineSize: width, blockSize: 0 }],
            contentRect: { width } as DOMRectReadOnly,
          } as unknown as ResizeObserverEntry,
        ],
        o as unknown as ResizeObserver,
      );
    }
  });
}

const NAMES = [
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
  ["Sun", "Sunday"],
] as const;

/** A Monday-first week at `kcal[i]` per day. */
function days(kcal: readonly number[]): ChartDay[] {
  return NAMES.map(([short, name], i) => ({
    weekday: (i + 1) % 7,
    short,
    name,
    kcal: kcal[i] ?? 0,
    training: i % 2 === 0,
    today: false,
  }));
}

/** The gutter labels the chart drew ("Average", "Floor"). */
function gutterLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("svg text"))
    .map((t) => t.textContent ?? "")
    .filter((t) => t === "Average" || t === "Floor");
}

beforeEach(() => {
  FakeResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TrainingWeekChart: the safety-floor line", () => {
  const renderChart = (mean: number, floor: number, kcal: number[]) => {
    const view = render(
      <TrainingWeekChart
        days={days(kcal)}
        mean={mean}
        floor={floor}
      />,
      { wrapper: intlWrapper() },
    );
    resizeTo(358);
    return view;
  };

  it("draws the floor as its own labelled line when there is room", () => {
    const { container } = renderChart(
      2000,
      1800,
      [2100, 1900, 2100, 1900, 2050, 1950, 2000],
    );
    expect(gutterLabels(container)).toEqual(["Average", "Floor"]);
  });

  it("leaves the floor out when it would sit on the average line", () => {
    // Mean = floor + 10 kcal: the two lines (and labels) would overlap.
    const { container } = renderChart(
      1810,
      1800,
      [1810, 1810, 1810, 1810, 1810, 1810, 1810],
    );
    expect(gutterLabels(container)).toEqual(["Average"]);
    expect(container.querySelectorAll("line[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("leaves the floor out at the floor itself", () => {
    const { container } = renderChart(
      1800,
      1800,
      [1800, 1800, 1800, 1800, 1800, 1800, 1800],
    );
    expect(gutterLabels(container)).toEqual(["Average"]);
  });
});

describe("TrainingWeekChart: today", () => {
  it("marks today's label in the brand accent, like Today's week strip", () => {
    const week = days([2100, 1900, 2100, 1900, 2050, 1950, 2000]).map((d) => ({
      ...d,
      today: d.short === "Sat",
    }));
    const { container } = render(
      <TrainingWeekChart
        days={week}
        mean={2000}
        floor={1800}
      />,
      { wrapper: intlWrapper() },
    );
    resizeTo(358);
    const label = (short: string) =>
      Array.from(container.querySelectorAll("svg text")).find(
        (t) => t.textContent === short,
      );
    expect(label("Sat")?.getAttribute("class")).toContain("fill-brand-text");
    expect(label("Sat")?.getAttribute("class")).not.toContain("fill-signal");
    expect(label("Fri")?.getAttribute("class")).toContain(
      "fill-muted-foreground",
    );
  });
});

describe("TrainingWeekChart: delta labels", () => {
  /** Each drawn delta label's baseline, by its text ("−244"). */
  const deltaLabels = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("svg text"))
      .filter((t) => /^[+−]/.test(t.textContent ?? ""))
      .map((t) => ({
        text: t.textContent ?? "",
        baseline: Number(t.getAttribute("y")),
      }));
  const floorY = (container: HTMLElement) => {
    const line = container.querySelector("line[stroke-dasharray]");
    return line === null ? null : Number(line.getAttribute("y1"));
  };
  /** A 12 px mono figure's ink above and below its baseline, plus the
   *  card-coloured halo (a 4 px stroke) around it. */
  const ASCENT = 9 + 2;
  const DESCENT = 3 + 2;
  const crosses = (baseline: number, line: number | null) =>
    line !== null && baseline - ASCENT < line && line < baseline + DESCENT;

  it.each([358, 328, 288])(
    "never cross the dashed floor line (the demo week, %ipx)",
    (width) => {
      // The sample profile's week (guest): a 1,744 average, a 1,409
      // floor, rest days at 1,500 (−244).
      const { container } = render(
        <TrainingWeekChart
          days={days([1850, 1500, 2000, 1500, 1850, 2000, 1500])}
          mean={1744}
          floor={1409}
        />,
        { wrapper: intlWrapper() },
      );
      resizeTo(width);
      const line = floorY(container);
      expect(line).not.toBeNull();
      const labels = deltaLabels(container);
      expect(labels.filter((l) => l.text === "−244")).toHaveLength(3);
      for (const { baseline } of labels)
        expect(crosses(baseline, line)).toBe(false);
    },
  );

  it("keep clear of the floor line across floors, above the day labels", () => {
    const kcal = [1850, 1500, 2000, 1500, 1850, 2000, 1500];
    for (let floor = 1200; floor <= 1500; floor += 10) {
      const { container } = render(
        <TrainingWeekChart
          days={days(kcal)}
          mean={1744}
          floor={floor}
        />,
        { wrapper: intlWrapper() },
      );
      resizeTo(358);
      const line = floorY(container);
      for (const { baseline } of deltaLabels(container)) {
        expect(
          crosses(baseline, line),
          `floor ${floor}: label at ${baseline}, line at ${line}`,
        ).toBe(false);
        // The day labels sit on a 144 baseline, about 10 px tall.
        expect(baseline + DESCENT).toBeLessThanOrEqual(144 - 10);
      }
      cleanup();
    }
  });
});
