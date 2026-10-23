// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChartZoomDialog } from "./ChartZoomDialog";

beforeEach(() => {
  // Fine pointer (desktop): the Dialog branch.
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Chart() {
  return (
    <div>
      <svg
        role="img"
        aria-label="Weight. Line chart, 3 entries."
      />
      <details>
        <summary>Show data table</summary>
      </details>
    </div>
  );
}

describe("ChartZoomDialog", () => {
  it("keeps the chart and its table disclosure outside the expand button", () => {
    render(
      <ChartZoomDialog title="Weight">
        <Chart />
      </ChartZoomDialog>,
    );
    // Inside a <button> the chart's summary would be presentational and
    // the <summary> an interactive control nested in another.
    expect(screen.getByRole("img").closest("button")).toBeNull();
    expect(screen.getByText("Show data table").closest("button")).toBeNull();
    expect(
      screen.getByRole("img", { name: "Weight. Line chart, 3 entries." }),
    ).toBeTruthy();
  });

  it("hides the expand button only for a fine pointer, never on touch", () => {
    render(
      <ChartZoomDialog title="Weight">
        <Chart />
      </ChartZoomDialog>,
    );
    const tokens = screen
      .getByRole("button", { name: "Expand Weight" })
      .className.split(/\s+/);
    // Tailwind v4 wraps `group-hover` in `@media (hover: hover)`, which a
    // touch tablet never matches. So any rule that hides the button must
    // itself be limited to a fine pointer, or nothing would reveal it.
    const hiding = tokens.filter((t) => /(^|:)opacity-0$/.test(t));
    expect(hiding).not.toEqual([]);
    for (const t of hiding) expect(t.split(":")).toContain("pointer-fine");
    // ...and the matching reveal is scoped the same way.
    expect(tokens).toContain("md:pointer-fine:group-hover/chart:opacity-100");
    expect(tokens).toContain("focus-visible:opacity-100");
  });

  it("opens the expanded view from its own button", () => {
    render(
      <ChartZoomDialog
        title="Weight"
        description="Last 30 days."
      >
        <Chart />
      </ChartZoomDialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Weight" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Last 30 days.")).toBeTruthy();
  });
});
