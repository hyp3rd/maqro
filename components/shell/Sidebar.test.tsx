/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NAV, SIDEBAR_GROUPS, VIEW_KEYS } from "./nav";

vi.mock("@/hooks/use-user-role", () => ({ useIsAdmin: () => false }));
vi.mock("./UserMenu", () => ({ UserMenu: () => null }));

const { Sidebar } = await import("./Sidebar");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/** The sidebar's destination buttons, in DOM order. */
function navButtons(): HTMLElement[] {
  const nav = within(
    screen.getByRole("complementary", { name: "Primary navigation" }),
  ).getByRole("navigation");
  return within(nav).getAllByRole("button");
}

describe("Sidebar", () => {
  it("renders every registry destination once, grouped, in registry order", () => {
    render(
      <Sidebar
        current="plan"
        onSelect={() => {}}
      />,
    );
    expect(navButtons().map((b) => b.textContent)).toEqual(
      SIDEBAR_GROUPS.flatMap((g) => g.items.map((k) => NAV[k].label)),
    );
    expect(navButtons()).toHaveLength(VIEW_KEYS.length);
    // The labelled sections are named groups.
    const library = screen.getByRole("group", { name: "Library" });
    expect(
      within(library)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Foods", "Recipes", "Templates"]);
    expect(
      within(screen.getByRole("group", { name: "You" }))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Profile", "Targets", "Health & fasting", "Settings"]);
    expect(screen.getByRole("group", { name: "Kitchen" })).toBeTruthy();
  });

  it("marks only the current view with aria-current=page", () => {
    render(
      <Sidebar
        current="calculator"
        onSelect={() => {}}
      />,
    );
    const current = navButtons().filter(
      (b) => b.getAttribute("aria-current") === "page",
    );
    expect(current.map((b) => b.textContent)).toEqual(["Targets"]);
  });

  it("selecting a destination reports its stable key", () => {
    const onSelect = vi.fn();
    render(
      <Sidebar
        current="plan"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.click(screen.getByRole("button", { name: "Targets" }));
    expect(onSelect.mock.calls).toEqual([["plan"], ["calculator"]]);
  });

  it("collapsed, keeps the grouping and names each icon button", () => {
    window.localStorage.setItem("maqro:sidebar-collapsed", "1");
    render(
      <Sidebar
        current="foods"
        onSelect={() => {}}
      />,
    );
    // Icon-only, but every destination still has its label as its name.
    for (const key of VIEW_KEYS) {
      expect(screen.getByRole("button", { name: NAV[key].label })).toBeTruthy();
    }
    expect(screen.getByRole("group", { name: "Library" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Foods" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
