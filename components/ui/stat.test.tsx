/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MacroStat } from "./macro-stat";
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
    );
    const group = screen.getByTestId("dl").firstElementChild as HTMLElement;
    expect(group.tagName).toBe("DIV");
    expect(
      Array.from(group.children).every((c) => ["DT", "DD"].includes(c.tagName)),
    ).toBe(true);
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
    );
    const dl = screen.getByTestId("dl");
    expect(pairs(dl)).toEqual([["Protein", ["/ 160 g", "85 g", ""]]]);
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
    );
    const over = screen.getByText("+114");
    expect(over.className).toContain("text-muted-foreground");
    expect(over.className).not.toMatch(/destructive|warning|red|amber/);
    const meter = screen.getByRole("meter", { name: "Carbs" });
    expect(meter.getAttribute("aria-valuenow")).toBe("314");
    expect(meter.querySelector("[data-part=overflow]")).not.toBeNull();
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
    );
    expect(pairs(screen.getByTestId("dl"))).toEqual([["Fat", ["12.5 g"]]]);
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("labels energy as Calories in kcal", () => {
    render(
      <dl data-testid="dl">
        <MacroStat
          macro="calories"
          value={1234.4}
        />
      </dl>,
    );
    expect(pairs(screen.getByTestId("dl"))).toEqual([
      ["Calories", ["1,234 kcal"]],
    ]);
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
    );
    const swatch = screen
      .getByTestId("dl")
      .querySelector("dt [aria-hidden=true]");
    expect(swatch?.className).toContain("bg-macro-carbs");
  });
});
