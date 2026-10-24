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
  within,
} from "@testing-library/react";
import { NAV, VIEW_KEYS } from "./nav";

vi.mock("@/hooks/use-user-role", () => ({ useIsAdmin: () => false }));
vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { CommandPalette } = await import("./CommandPalette");

beforeEach(() => {
  // cmdk measures its list and scrolls the active item into view; jsdom
  // ships neither API.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open() {
  act(() => {
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  });
  return screen.getByRole("dialog");
}

describe("CommandPalette", () => {
  it("lists every registry destination under Navigate", () => {
    render(<CommandPalette onSelectView={() => {}} />);
    const dialog = open();
    const group = within(dialog).getByRole("group", { name: "Navigate" });
    expect(
      within(group)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(VIEW_KEYS.map((k) => NAV[k].label));
  });

  it("finds a destination by a keyword and opens it by its key", () => {
    const onSelectView = vi.fn();
    render(<CommandPalette onSelectView={onSelectView} />);
    const dialog = open();
    fireEvent.change(within(dialog).getByRole("combobox"), {
      target: { value: "tdee" },
    });
    // cmdk ranks fuzzy matches; the keyword match ranks first.
    const best = within(dialog).getAllByRole("option")[0]!;
    expect(best.textContent).toBe("Targets");
    fireEvent.click(best);
    expect(onSelectView).toHaveBeenCalledWith("calculator");
  });
});
