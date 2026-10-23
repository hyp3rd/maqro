// @vitest-environment jsdom
import { dayIndexFromIsoDate } from "@/lib/charts/geometry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { type LinePoint, MiniLineChart } from "./MiniLineChart";

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

function resizeAll(width: number) {
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

const day = (d: number) =>
  dayIndexFromIsoDate(`2026-10-${String(d).padStart(2, "0")}`);

/** A week of calories in the shape the visual audit measured. */
const calories: LinePoint[] = [1200, 1450, 1870, 1500, 1640, 1380, 1550].map(
  (y, i) => ({ x: day(17 + i), y, label: `Oct ${17 + i}` }),
);

function svg(container: HTMLElement): SVGSVGElement {
  const el = container.querySelector("svg");
  if (!el) throw new Error("no chart svg");
  return el;
}

function texts(container: HTMLElement): string[] {
  return [...svg(container).querySelectorAll("text")].map(
    (t) => t.textContent ?? "",
  );
}

beforeEach(() => {
  FakeResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MiniLineChart sizing", () => {
  it("draws in real pixels once the container is measured", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        height={240}
      />,
    );
    // Before the first observation: the fallback drawing width.
    expect(svg(container).getAttribute("viewBox")).toBe("0 0 640 240");
    resizeAll(327);
    // 1 viewBox unit = 1 CSS px, so 12px labels render at 12px on a phone.
    expect(svg(container).getAttribute("viewBox")).toBe("0 0 327 240");
    expect(svg(container).getAttribute("height")).toBe("240");
    resizeAll(702);
    expect(svg(container).getAttribute("viewBox")).toBe("0 0 702 240");
  });

  it("prints at the drawing width, scaled to the page, not the phone width", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        height={240}
      />,
    );
    resizeAll(327);
    // No act(): the chart must already have re-rendered when the event
    // returns, because the print dialog captures the page right after.
    window.dispatchEvent(new Event("beforeprint"));
    expect(svg(container).getAttribute("viewBox")).toBe("0 0 640 240");
    // Height follows the viewBox, so the chart fills the printed column.
    expect(svg(container).hasAttribute("height")).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(svg(container).getAttribute("viewBox")).toBe("0 0 327 240");
    expect(svg(container).getAttribute("height")).toBe("240");
  });

  it("uses true-size (12px) text, not the old 10px", () => {
    const { container } = render(<MiniLineChart data={calories} />);
    resizeAll(327);
    for (const t of svg(container).querySelectorAll("text")) {
      expect(t.getAttribute("class")).toContain("text-xs");
      expect(t.getAttribute("class")).not.toContain("text-[10px]");
    }
  });
});

describe("MiniLineChart axes", () => {
  it("labels the y axis on round values with the unit shown once", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        height={240}
        yUnit=" kcal"
      />,
    );
    resizeAll(327);
    const labels = texts(container);
    expect(labels).toEqual(
      expect.arrayContaining(["1,200", "1,400", "1,600", "1,800", "2,000"]),
    );
    expect(labels.filter((l) => l === "kcal")).toHaveLength(1);
    // None of the raw quartile values.
    expect(labels.some((l) => /1,?164|1,?350|1,?536/.test(l))).toBe(false);
  });

  it("puts date labels on an even calendar step for day series", () => {
    const month: LinePoint[] = Array.from({ length: 30 }, (_, i) => ({
      x: day(1 + i),
      y: 68 + (i % 5) / 10,
      label: `#${i}`,
    }));
    const { container } = render(
      <MiniLineChart
        data={month}
        xType="day"
        yUnit=" kg"
      />,
    );
    resizeAll(327);
    const dates = texts(container).filter((l) => /^Oct \d+$/.test(l));
    // Mondays of October 2026 (or a subset of them), never index-picked.
    expect(dates.length).toBeGreaterThanOrEqual(2);
    for (const d of dates) {
      expect(["Oct 5", "Oct 12", "Oct 19", "Oct 26"]).toContain(d);
    }
  });

  /** Oct 10-23: a span (13 days) no 1/2/3-day step lands on twice. */
  const fortnight: LinePoint[] = Array.from({ length: 14 }, (_, i) => ({
    x: day(10 + i),
    y: 1500 + (i % 3) * 200,
  }));

  it.each([
    // A narrow phone card: the week's first and last day, and its middle.
    ["week", 200, calories, ["Oct 17", "Oct 20", "Oct 23"]],
    ["week", 320, calories, ["Oct 17", "Oct 19", "Oct 21", "Oct 23"]],
    [
      "week",
      680,
      calories,
      ["Oct 17", "Oct 18", "Oct 19", "Oct 20", "Oct 21", "Oct 22", "Oct 23"],
    ],
    // Room for two labels only: both ends, not a lone Monday or two.
    ["fortnight", 200, fortnight, ["Oct 10", "Oct 23"]],
    ["fortnight", 260, fortnight, ["Oct 10", "Oct 23"]],
  ] as const)(
    "dates a %s at %ipx from its first to its last day, evenly, without overlap",
    (_name, width, data, expected) => {
      for (const variant of ["line", "bar"] as const) {
        const { container, unmount } = render(
          <MiniLineChart
            data={[...data]}
            xType="day"
            variant={variant}
          />,
        );
        resizeAll(width);
        const labels = [...svg(container).querySelectorAll("text")].filter(
          (t) => /^Oct \d+$/.test(t.textContent ?? ""),
        );
        expect({ variant, dates: labels.map((t) => t.textContent) }).toEqual({
          variant,
          dates: expected,
        });
        // Label boxes (12px mono: 0.6em per glyph) never touch, and stay
        // inside the chart.
        const boxes = labels.map((t) => {
          const x = Number(t.getAttribute("x"));
          const half = ((t.textContent ?? "").length * 7.2) / 2;
          return { left: x - half, right: x + half };
        });
        for (let i = 1; i < boxes.length; i++) {
          expect(boxes[i]?.left ?? 0).toBeGreaterThan(boxes[i - 1]?.right ?? 0);
        }
        expect(boxes[0]?.left ?? -1).toBeGreaterThanOrEqual(0);
        expect(boxes[boxes.length - 1]?.right ?? Infinity).toBeLessThanOrEqual(
          width,
        );
        unmount();
        FakeResizeObserver.all = [];
      }
    },
  );

  it("keeps the date labels evenly stepped at every width", () => {
    // Starts on a one-digit day ("Oct 1") but most labels have two digits.
    const month: LinePoint[] = Array.from({ length: 31 }, (_, i) => ({
      x: day(1 + i),
      y: 1800 + (i % 4) * 100,
    }));
    const { container } = render(
      <MiniLineChart
        data={month}
        xType="day"
      />,
    );
    for (let w = 200; w <= 960; w += 4) {
      resizeAll(w);
      const days = texts(container)
        .map((l) => /^Oct (\d+)$/.exec(l)?.[1])
        .filter((d): d is string => d !== undefined)
        .map(Number);
      const gaps = [
        ...new Set(days.slice(1).map((d, i) => d - (days[i] ?? 0))),
      ];
      const step = gaps[0] ?? 0;
      const first = days[0] ?? 0;
      const last = days[days.length - 1] ?? 0;
      expect({
        width: w,
        // One calendar step throughout: no tick dropped from the middle...
        oneStep: gaps.length === 1,
        // ...nor from either end, where the edge clamp pulls a label
        // towards its neighbour: one more step either way leaves October.
        noneBefore: first - step < 1,
        noneAfter: last + step > 31,
      }).toEqual({
        width: w,
        oneStep: true,
        noneBefore: true,
        noneAfter: true,
      });
    }
  });
});

describe("MiniLineChart line", () => {
  it("draws straight segments by default (no overshooting curve)", () => {
    const { container } = render(<MiniLineChart data={calories} />);
    resizeAll(327);
    const line = container.querySelector('[data-part="line"]');
    expect(line?.getAttribute("d")).toMatch(
      /^M[\d.]+,[\d.]+( L[\d.]+,[\d.]+)+$/,
    );
  });

  it("smooths with a monotone curve when asked", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        smooth
      />,
    );
    resizeAll(327);
    expect(
      container.querySelector('[data-part="line"]')?.getAttribute("d"),
    ).toContain("C");
  });

  it("draws a per-day target series as a step line beside targetY", () => {
    const targets = calories.map((p, i) => ({
      x: p.x,
      y: i % 2 === 0 ? 1950 : 2300,
    }));
    const { container } = render(
      <MiniLineChart
        data={calories}
        targetY={2100}
        targetSeries={targets}
      />,
    );
    resizeAll(327);
    const step = container.querySelector('[data-part="target-step"]');
    const d = step?.getAttribute("d") ?? "";
    // One horizontal run per day: M + (2 points per day) - 1 L commands.
    expect(d.startsWith("M")).toBe(true);
    expect(d.match(/L/g)).toHaveLength(targets.length * 2 - 1);
    expect(container.querySelector('[data-part="target-line"]')).not.toBeNull();
  });

  it("marks today with the signal token", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        highlightX={day(23)}
      />,
    );
    resizeAll(327);
    expect(container.querySelector(".fill-signal")).not.toBeNull();
  });
});

describe("MiniLineChart bars", () => {
  const week = [
    { x: day(19), y: 2280 },
    { x: day(20), y: 2060 },
    { x: day(21), y: 1240 },
  ];

  it("draws one bar per day, starting from zero", () => {
    const { container } = render(
      <MiniLineChart
        data={week}
        variant="bar"
        targetY={1950}
        height={200}
      />,
    );
    resizeAll(320);
    const bars = container.querySelectorAll('[data-part="bar"]');
    expect(bars).toHaveLength(3);
    // y axis includes 0 so bar lengths are honest.
    expect(texts(container)).toContain("0");
  });

  it("leaves an empty slot for each unlogged day on a day axis", () => {
    // Logged every other day: 19, 21, 23 -> five day slots, not three.
    const { container } = render(
      <MiniLineChart
        data={[
          { x: day(19), y: 1800 },
          { x: day(21), y: 1900 },
          { x: day(23), y: 2000 },
        ]}
        variant="bar"
        xType="day"
      />,
    );
    resizeAll(320);
    const xs = [...container.querySelectorAll('[data-part="bar"]')].map(
      (b) => Number(b.getAttribute("x")) + Number(b.getAttribute("width")) / 2,
    );
    const [a, b, c] = xs;
    if (a === undefined || b === undefined || c === undefined)
      throw new Error("expected three bars");
    const hit = container.querySelector('[data-part="hit"]');
    const left = Number(hit?.getAttribute("x"));
    const plotW = Number(hit?.getAttribute("width"));
    const slot = plotW / 5;
    // Bars sit at the centres of slots 1, 3 and 5 of five.
    expect(a - left).toBeCloseTo(slot / 2);
    expect(b - left).toBeCloseTo(2.5 * slot);
    expect(c - left).toBeCloseTo(4.5 * slot);
  });

  it("shows overshoot calmly: same hue, lower intensity, neutral +N", () => {
    const { container } = render(
      <MiniLineChart
        data={week}
        variant="bar"
        targetY={1950}
      />,
    );
    resizeAll(320);
    const over = container.querySelectorAll('[data-part="bar-over"]');
    expect(over).toHaveLength(2); // 2280 and 2060 are past 1950
    for (const o of over) {
      const cls = o.getAttribute("class") ?? "";
      expect(cls).toMatch(/fill-foreground\/\d+/);
      expect(cls).not.toMatch(/destructive|red|green|success|warning/);
    }
    const labels = texts(container);
    expect(labels).toContain("+330");
    expect(labels).toContain("+110");
  });

  it("uses each day's own target from the series", () => {
    const { container } = render(
      <MiniLineChart
        data={week}
        variant="bar"
        targetSeries={[
          { x: day(19), y: 2300 },
          { x: day(20), y: 1950 },
          { x: day(21), y: 2500 },
        ]}
      />,
    );
    resizeAll(320);
    // Only Tue (2060 vs 1950) is over its own target.
    expect(container.querySelectorAll('[data-part="bar-over"]')).toHaveLength(
      1,
    );
    expect(texts(container)).toContain("+110");
  });
});

describe("MiniLineChart accessibility", () => {
  it("summarises the series in the image's accessible name", () => {
    render(
      <MiniLineChart
        data={calories}
        title="Calories"
        yUnit=" kcal"
        targetY={1744}
      />,
    );
    resizeAll(327);
    const img = screen.getByRole("img");
    const name = img.getAttribute("aria-label") ?? "";
    expect(name).toContain("Calories");
    expect(name).toContain("7 entries");
    expect(name).toContain("Oct 17");
    expect(name).toContain("Oct 23");
    expect(name).toContain("1,200 kcal");
    expect(name).toContain("1,870 kcal");
    expect(name).toContain("latest 1,550 kcal");
    expect(name).toContain("1,744 kcal");
  });

  it("summarises only the daily targets inside the plotted range", () => {
    render(
      <MiniLineChart
        data={calories}
        title="Calories"
        yUnit=" kcal"
        xType="day"
        targetSeries={[
          // Before the data starts: not drawn, so not in the summary either.
          { x: day(10), y: 2400 },
          { x: day(17), y: 1800 },
          { x: day(20), y: 1950 },
          // After the data ends.
          { x: day(30), y: 1500 },
        ]}
      />,
    );
    resizeAll(327);
    const name = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(name).toContain("Daily targets from 1,800 kcal to 1,950 kcal.");
    expect(name).not.toContain("2,400");
    expect(name).not.toContain("1,500 kcal");
  });

  it("offers the data as a table behind a keyboard-reachable disclosure", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        title="Calories"
        yUnit=" kcal"
        targetY={1744}
      />,
    );
    const summary = container.querySelector("details > summary");
    expect(summary?.textContent).toMatch(/table/i);
    const table = screen.getByRole("table", { hidden: true });
    expect(table.querySelector("caption")?.textContent).toContain("Calories");
    const headers = [...table.querySelectorAll("th[scope=col]")].map(
      (h) => h.textContent,
    );
    expect(headers).toEqual(["Date", "Value (kcal)", "Target (kcal)"]);
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(calories.length);
    expect(rows[2]?.textContent).toContain("1,870");
    expect(rows[2]?.querySelector("th")?.getAttribute("scope")).toBe("row");
    // Kept off paper: the chart itself is the printed form.
    expect(container.querySelector("details")?.className).toContain(
      "print-hide",
    );
  });

  it("names each chart's data-table disclosure after its chart", () => {
    const { container } = render(
      <>
        <MiniLineChart
          data={calories}
          title="Weight"
        />
        <MiniLineChart
          data={calories}
          title="Calories per day"
        />
        <MiniLineChart data={calories} />
      </>,
    );
    const summaries = [...container.querySelectorAll("details > summary")];
    // The name comes from the content: the visible words first (so a
    // speech-input user can say them), then the chart, read only by AT.
    expect(summaries.map((s) => s.textContent)).toEqual([
      "Show data table for Weight",
      "Show data table for Calories per day",
      // No title: nothing to name it after, so no made-up name either.
      "Show data table",
    ]);
    for (const s of summaries) {
      const visible = [...s.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("");
      expect(visible).toBe("Show data table");
      const hidden = s.querySelector("span");
      if (hidden) expect(hidden.className).toBe("sr-only");
    }
  });
});

describe("MiniLineChart tooltip", () => {
  it("shows the nearest point's value on hover and clears on mouse leave", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        yUnit=" kcal"
        height={240}
      />,
    );
    resizeAll(320);
    const el = svg(container);
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 320, height: 240 }) as DOMRect;
    const overlay = container.querySelector('[data-part="hit"]');
    if (!overlay) throw new Error("no hit area");
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 100 });
    expect(
      texts(container).some((t) => t.includes("Oct 23 · 1,550 kcal")),
    ).toBe(true);
    fireEvent.pointerLeave(overlay, { pointerType: "mouse" });
    expect(texts(container).some((t) => t.includes("Oct 23 ·"))).toBe(false);
  });

  it("keeps a tapped value up after the finger lifts, with its target", () => {
    const { container } = render(
      <MiniLineChart
        data={calories}
        yUnit=" kcal"
        variant="bar"
        targetY={1744}
        height={240}
      />,
    );
    resizeAll(320);
    svg(container).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 320, height: 240 }) as DOMRect;
    const overlay = container.querySelector('[data-part="hit"]');
    if (!overlay) throw new Error("no hit area");
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 100 });
    fireEvent.pointerLeave(overlay, { pointerType: "touch" });
    expect(
      texts(container).some((t) =>
        t.includes("Oct 23 · 1,550 kcal · target 1,744"),
      ),
    ).toBe(true);
  });

  it("puts a tapped value away on a tap outside the chart", () => {
    const { container } = render(
      <div>
        <MiniLineChart
          data={calories}
          yUnit=" kcal"
          height={240}
        />
        <p>Elsewhere on the page</p>
      </div>,
    );
    resizeAll(320);
    svg(container).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 320, height: 240 }) as DOMRect;
    const overlay = container.querySelector('[data-part="hit"]');
    if (!overlay) throw new Error("no hit area");
    const tooltipUp = () =>
      texts(container).some((t) => t.includes("Oct 23 · 1,550 kcal"));

    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 100 });
    fireEvent.pointerLeave(overlay, { pointerType: "touch" });
    expect(tooltipUp()).toBe(true);
    // Another tap on the chart moves it rather than closing it...
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 120 });
    expect(tooltipUp()).toBe(true);
    // ...and a tap anywhere else puts it away.
    fireEvent.pointerDown(screen.getByText("Elsewhere on the page"));
    expect(tooltipUp()).toBe(false);
  });
});

it("renders nothing for an empty series", () => {
  const { container } = render(<MiniLineChart data={[]} />);
  expect(container.firstChild).toBeNull();
});
