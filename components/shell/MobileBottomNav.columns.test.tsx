/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type * as NavModule from "./nav";

/** The bar's grid follows the registry: when a change drops a slot (the
 *  Suggestions change takes More out of `TAB_BAR`), the remaining slots
 *  share the width instead of leaving an empty fifth column. */

vi.mock("./nav", async (importOriginal) => {
  const nav = await importOriginal<typeof NavModule>();
  return {
    ...nav,
    TAB_BAR: nav.TAB_BAR.filter((slot) => slot !== "more"),
    MORE_IN_TAB_BAR: false,
  };
});
vi.mock("@/lib/haptics", () => ({ haptic: () => {} }));

const { MobileBottomNav } = await import("./MobileBottomNav");

afterEach(() => {
  cleanup();
});

describe("MobileBottomNav with four slots", () => {
  it("has four equal columns", () => {
    render(
      <MobileBottomNav
        current="plan"
        onSelect={() => {}}
        onQuickAdd={() => {}}
      />,
    );
    const bar = screen.getByRole("navigation", {
      name: "Primary navigation (mobile)",
    });
    expect(within(bar).getAllByRole("button")).toHaveLength(4);
    expect(bar.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
    expect(bar.className).not.toMatch(/\bgrid-cols-\d/);
  });
});
