/**
 * @vitest-environment jsdom
 */
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Meal } from "./types";

// The recents strip reads IndexedDB; only the launcher's own steps matter.
vi.mock("./QuickAddFoods", () => ({ QuickAddFoods: () => null }));

const { LogMealSheet } = await import("./LogMealSheet");

const MEALS: Meal[] = [
  { id: 1, name: "Breakfast", foods: [] },
  { id: 2, name: "Lunch", foods: [] },
];

afterEach(() => {
  cleanup();
});

function renderSheet(initialMealId: number | null, aiAvailable = true) {
  const onMethod = vi.fn();
  render(
    <LogMealSheet
      open
      onOpenChange={() => {}}
      meals={MEALS}
      dayLabel="Today"
      aiAvailable={aiAvailable}
      initialMealId={initialMealId}
      onMethod={onMethod}
      onQuickLog={() => {}}
    />,
  );
  return { onMethod };
}

describe("LogMealSheet names its target", () => {
  it("pre-targeted: the title names the meal and the day", () => {
    renderSheet(2);
    expect(
      screen.getByRole("dialog", { name: "Add to Lunch · Today" }),
    ).toBeTruthy();
  });

  it("at the meal step: the title names the day", () => {
    renderSheet(null);
    expect(
      screen.getByRole("dialog", { name: "Log a meal · Today" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Breakfast/ }));
    expect(
      screen.getByRole("dialog", { name: "Add to Breakfast · Today" }),
    ).toBeTruthy();
  });

  it("Photo and Voice stay in the method step, AI-gated", () => {
    const { onMethod } = renderSheet(2);
    fireEvent.click(screen.getByRole("button", { name: /Photo/ }));
    expect(onMethod).toHaveBeenCalledWith("photo", 2);
    expect(screen.getByRole("button", { name: /Voice/ })).toBeTruthy();
    cleanup();
    renderSheet(2, false);
    expect(screen.queryByRole("button", { name: /Photo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Voice/ })).toBeNull();
  });
});

describe("LogMealSheet eaten now or later", () => {
  function renderWithChoice(later: boolean | null) {
    const onLaterChange = vi.fn();
    render(
      <LogMealSheet
        open
        onOpenChange={() => {}}
        meals={MEALS}
        dayLabel="Today"
        aiAvailable
        initialMealId={2}
        onMethod={() => {}}
        onQuickLog={() => {}}
        laterChoice={later === null ? undefined : { later, onLaterChange }}
      />,
    );
    return { onLaterChange };
  }

  it("offers 'Eaten now / Later' on the method step, eaten now first", () => {
    const { onLaterChange } = renderWithChoice(false);
    expect(
      screen.getByRole("radiogroup", { name: "When you eat it" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "Eaten now" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Later" }));
    expect(onLaterChange).toHaveBeenCalledWith(true);
  });

  it("has no choice on another day", () => {
    renderWithChoice(null);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("LogMealSheet focus", () => {
  /** The launcher has no Radix trigger: the tab bar's [+] opens it. */
  function Opener() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
        >
          Quick add
        </button>
        <LogMealSheet
          open={open}
          onOpenChange={setOpen}
          meals={MEALS}
          dayLabel="Today"
          aiAvailable
          initialMealId={2}
          onMethod={() => {}}
          onQuickLog={() => {}}
        />
      </>
    );
  }

  it("closing focuses the explicit return target even if tapping it never focused it", async () => {
    // iOS Safari doesn't focus a tapped <button>, so at open time focus is
    // still on <body>; the launcher must use the [+] it was handed.
    function TapOpener() {
      const [open, setOpen] = useState(false);
      const plus = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button
            ref={plus}
            type="button"
            onClick={() => setOpen(true)}
          >
            Quick add
          </button>
          <LogMealSheet
            open={open}
            onOpenChange={setOpen}
            meals={MEALS}
            dayLabel="Today"
            aiAvailable
            initialMealId={2}
            onMethod={() => {}}
            onQuickLog={() => {}}
            returnFocusTo={plus}
          />
        </>
      );
    }
    render(<TapOpener />);
    const plus = screen.getByRole("button", { name: "Quick add" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(plus);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(plus);
    });
  });

  it("closing hands focus back to what opened it", async () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Quick add" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });
});
