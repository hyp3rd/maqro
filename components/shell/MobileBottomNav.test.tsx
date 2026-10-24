/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MORE_SHEET, NAV, TAB_BAR, type ViewKey } from "./nav";

const haptic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/haptics", () => ({ haptic }));

const { MobileBottomNav } = await import("./MobileBottomNav");

beforeEach(() => {
  haptic.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderNav(current: ViewKey = "plan") {
  const onSelect = vi.fn();
  const onQuickAdd = vi.fn();
  render(
    <MobileBottomNav
      current={current}
      onSelect={onSelect}
      onQuickAdd={onQuickAdd}
    />,
  );
  const bar = screen.getByRole("navigation", {
    name: "Primary navigation (mobile)",
  });
  return { bar, onSelect, onQuickAdd };
}

describe("MobileBottomNav", () => {
  it("has five slots: Today · Progress · Quick add · More · You", () => {
    const { bar } = renderNav();
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Today", "Progress", "Quick add", "More", "You"]);
  });

  it("marks only the current tab with aria-current=page", () => {
    const { bar } = renderNav("progress");
    const current = within(bar)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "page");
    expect(current.map((b) => b.textContent)).toEqual(["Progress"]);
  });

  it("a destination behind More or You lights that slot, without aria-current", () => {
    const { bar } = renderNav("foods");
    const more = within(bar).getByRole("button", { name: "More" });
    expect(more.dataset.active).toBe("true");
    expect(more.getAttribute("aria-current")).toBeNull();
    cleanup();
    const you = within(renderNav("calculator").bar).getByRole("button", {
      name: "You",
    });
    expect(you.dataset.active).toBe("true");
    expect(you.getAttribute("aria-current")).toBeNull();
  });

  it("a tab reports its stable key with a selection haptic", () => {
    const { bar, onSelect } = renderNav();
    fireEvent.click(within(bar).getByRole("button", { name: "You" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Progress" }));
    expect(onSelect.mock.calls).toEqual([["profile"], ["progress"]]);
    expect(haptic).toHaveBeenCalledWith("select");
  });

  it("the centre button asks for a quick add with a tap haptic", () => {
    const { bar, onQuickAdd, onSelect } = renderNav("settings");
    const plus = within(bar).getByRole("button", { name: "Quick add" });
    fireEvent.click(plus);
    // Hands over itself: the launcher's focus-return target (iOS Safari
    // doesn't focus a tapped button, so focus can't be read back later).
    expect(onQuickAdd.mock.calls).toEqual([[plus]]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(haptic).toHaveBeenCalledWith("tap");
  });

  it("lays the bar out with one column per slot", () => {
    const { bar } = renderNav();
    expect(bar.style.gridTemplateColumns).toBe(
      `repeat(${TAB_BAR.length}, minmax(0, 1fr))`,
    );
  });

  it("the centre button fills with brand-strong, the fill behind a brand-foreground label", () => {
    const { bar } = renderNav("plan");
    const add = within(bar).getByRole("button", { name: "Quick add" });
    expect(add.className).toContain("bg-brand-strong");
    expect(add.className).toContain("text-brand-foreground");
  });
});

describe("More sheet", () => {
  function openMore(current: ViewKey = "plan") {
    const r = renderNav(current);
    const trigger = within(r.bar).getByRole("button", { name: "More" });
    trigger.focus();
    fireEvent.click(trigger);
    const sheet = screen.getByRole("dialog", { name: "More" });
    return { ...r, trigger, sheet };
  }

  it("opens as a dialog listing the More destinations in order", () => {
    const { sheet, trigger } = openMore();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(sheet)
        .getAllByRole("button")
        .filter((b) => b.textContent !== "Close")
        .map((b) => b.textContent),
    ).toEqual(MORE_SHEET.map((k) => NAV[k].label));
  });

  it("marks the open view inside the sheet", () => {
    const { sheet } = openMore("pantry");
    expect(
      within(sheet)
        .getByRole("button", { name: "Pantry" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("navigates, closes, and returns focus to More", async () => {
    const { sheet, trigger, onSelect } = openMore();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Foods" }));
    });
    expect(onSelect).toHaveBeenCalledWith("foods");
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
    // Radix's FocusScope restores focus on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("Escape closes without navigating and returns focus to More", async () => {
    const { sheet, trigger, onSelect } = openMore();
    await act(async () => {
      fireEvent.keyDown(sheet, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
