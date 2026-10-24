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
