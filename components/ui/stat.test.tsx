/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MacroStat, type MacroStatProps } from "./macro-stat";
import { Stat } from "./stat";

afterEach(() => cleanup());

/** The term/definition pairs a `<dl>` exposes, as text. */
function pairs(list: HTMLElement): [string, string[]][] {
  return Array.from(list.querySelectorAll("dt")).map((dt) => {
    const dds: string[] = [];
    let next = dt.nextElementSibling;
    while (next && next.tagName === "DD") {
      dds.push(next.textContent ?? "");
      next = next.nextElementSibling;
    }
    return [dt.textContent ?? "", dds];
  });
}

describe("Stat", () => {
  it("is a label/value pair with a tabular mono figure", () => {
    render(
      <dl data-testid="dl">
        <Stat
          label="Weekly average"
          value="2,200"
          unit="kcal"
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([["Weekly average", ["2,200 kcal"]]]);
    const figure = dl.querySelector("dd");
    expect(figure?.className).toContain("font-mono");
    expect(figure?.className).toContain("tabular-nums");
    // Readable sentence-case label, not 11px uppercase mono.
    const term = dl.querySelector("dt");
    expect(term?.className).toContain("text-label");
    expect(term?.className).not.toContain("uppercase");
  });

  it("keeps only dt/dd children so it stays valid inside a <dl>", () => {
    render(
      <dl data-testid="dl">
        <Stat
          label="Protein"
          value="85"
          unit="g"
          detail="/ 160 g"
          note="+5"
        >
          <span>bar</span>
        </Stat>
      </dl>,
      { wrapper: intlWrapper() },
    );
    const group = screen.getByTestId("dl").firstElementChild as HTMLElement;
    expect(group.tagName).toBe("DIV");
    expect(
      Array.from(group.children).every((c) => ["DT", "DD"].includes(c.tagName)),
    ).toBe(true);
  });
  it("reads the figure before the detail, keeping the detail on the label row", () => {
    render(
      <dl data-testid="dl">
        <Stat
          label="Protein"
          value="85"
          unit="g"
          detail="/ 160 g"
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const dl = screen.getByTestId("dl");
    // Reading order is DOM order: "Protein, 85 g, / 160 g", not the old
    // "Protein, / 160 g, 85 g".
    expect(within(dl).getByRole("term").textContent).toBe("Protein");
    expect(
      within(dl)
        .getAllByRole("definition")
        .map((dd) => dd.textContent),
    ).toEqual(["85 g", "/ 160 g"]);
    // The grid still draws the detail at the end of the label row.
    const detail = within(dl).getByText("/ 160 g");
    expect(detail.className).toContain("row-start-1");
    expect(detail.className).toContain("col-start-2");
  });
});

describe("MacroStat", () => {
  it("shows the macro label, value, unit and target", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="protein"
          value={85}
          target={160}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([["Protein", ["85 g", "/ 160 g", ""]]]);
    expect(
      within(dl)
        .getByRole("meter", { name: "Protein" })
        .getAttribute("aria-valuetext"),
    ).toBe("85 g of 160 g");
  });

  it("shows a calm, neutral +N when over target and keeps the meter unclamped", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="carbs"
          value={314}
          target={200}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const over = screen.getByText("+114");
    expect(over.className).toContain("text-muted-foreground");
    expect(over.className).not.toMatch(/destructive|warning|red|amber/);
    const meter = screen.getByRole("meter", { name: "Carbs" });
    expect(meter.getAttribute("aria-valuenow")).toBe("314");
    expect(meter.querySelector("[data-part=overflow]")).not.toBeNull();
  });

  it("derives +N from the figures it shows for a fractional target", () => {
    // 161.6 vs 160.4 reads "162 / 160 g", so the note says +2 (raw 1.2
    // would say +1) and the meter speaks the same numbers.
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="protein"
          value={161.6}
          target={160.4}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([["Protein", ["162 g +2", "/ 160 g", ""]]]);
    expect(
      within(dl)
        .getByRole("meter", { name: "Protein" })
        .getAttribute("aria-valuetext"),
    ).toBe("162 g of 160 g, 2 g above target");
  });

  it("is not over target when value and target show the same figure", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="protein"
          value={160.45}
          target={160.2}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([["Protein", ["160 g", "/ 160 g", ""]]]);
    const meter = within(dl).getByRole("meter", { name: "Protein" });
    expect(meter.getAttribute("aria-valuetext")).toBe("160 g of 160 g");
    expect(meter.querySelector("[data-part=overflow]")).toBeNull();
  });

  it("rounds at the given precision before comparing", () => {
    // 161.66 vs 160.34 at one decimal: 161.7 / 160.3, so +1.4 (raw 1.32
    // would read +1.3).
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="carbs"
          value={161.66}
          target={160.34}
          decimals={1}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([["Carbs", ["161.7 g +1.4", "/ 160.3 g", ""]]]);
    expect(
      within(dl)
        .getByRole("meter", { name: "Carbs" })
        .getAttribute("aria-valuetext"),
    ).toBe("161.7 g of 160.3 g, 1.4 g above target");
  });

  it("omits the target, meter and +N without a target", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="fat"
          value={12.5}
          format={(n) => n.toFixed(1)}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    expect(pairs(screen.getByTestId("dl"))).toEqual([["Fat", ["12.5 g"]]]);
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("treats a zero target as no target on screen and in the meter", () => {
    // No goals yet: the meter keeps its slot as an empty track, but there
    // is no "/ 0 g" figure or "+N" note to contradict its "no target".
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="protein"
          value={85}
          target={0}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([["Protein", ["85 g", ""]]]);
    expect(within(dl).queryByText(/^\+/)).toBeNull();
    const meter = within(dl).getByRole("meter", { name: "Protein" });
    expect(meter.getAttribute("aria-valuetext")).toBe("85 g, no target");
    expect(meter.querySelector("[data-part=target]")).toBeNull();
  });

  it("labels energy as Calories in kcal", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="calories"
          value={1234.4}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    expect(pairs(screen.getByTestId("dl"))).toEqual([
      ["Calories", ["1,234 kcal"]],
    ]);
  });

  it("groups figures for the app locale, not always the English way", () => {
    // Italian reads "1,234" as 1.234; CLDR Italian leaves four digits
    // ungrouped and groups five with a dot.
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="calories"
          value={1234.4}
        />
        <MacroStat
          macro="carbs"
          value={12345.6}
          target={10000}
        />
      </dl>,
      { wrapper: intlWrapper("it") },
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([
      ["Calories", ["1234 kcal"]],
      // The "+2346" overshoot is aria-hidden; the meter speaks it.
      ["Carbs", ["12.346 g +2346", "/ 10.000 g", ""]],
    ]);
    expect(
      within(dl)
        .getByRole("meter", { name: "Carbs" })
        .getAttribute("aria-valuetext"),
    ).toBe("12.346 g of 10.000 g, 2346 g above target");
  });

  it("shows a placeholder, not NaN, for a value that is not a number", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="protein"
          value={Number.NaN}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    expect(pairs(screen.getByTestId("dl"))).toEqual([["Protein", ["— g"]]]);
  });

  it("accepts only the readout precisions", () => {
    expectTypeOf<MacroStatProps["decimals"]>().toEqualTypeOf<
      0 | 1 | 2 | undefined
    >();
  });

  it("lets a caller replace the figure (e.g. an animated ticker)", () => {
    render(
      <dl>
        <MacroStat
          macro="protein"
          value={85}
          target={160}
        >
          <span data-testid="ticker">84</span>
        </MacroStat>
      </dl>,
      { wrapper: intlWrapper() },
    );
    expect(screen.getByTestId("ticker").textContent).toBe("84");
    // The meter still reads the real value.
    expect(
      screen
        .getByRole("meter", { name: "Protein" })
        .getAttribute("aria-valuenow"),
    ).toBe("85");
  });

  it("marks the macro with its colour swatch, decoratively", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="carbs"
          value={10}
        />
      </dl>,
      { wrapper: intlWrapper() },
    );
    const swatch = screen
      .getByTestId("dl")
      .querySelector("dt [aria-hidden=true]");
    expect(swatch?.className).toContain("bg-macro-carbs");
  });
});
