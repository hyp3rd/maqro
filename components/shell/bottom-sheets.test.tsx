/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Meal } from "../macro/types";

/** One bottom-sheet language: the sheets the tab bar opens — More, and the
 *  quick-add launcher (LogMealSheet) — share the same grab handle (drag it
 *  down to dismiss), title treatment, close button and Escape. */

vi.mock("@/lib/haptics", () => ({ haptic: () => {} }));
// The launcher's recents strip reads IndexedDB; only the sheet matters here.
vi.mock("../macro/QuickAddFoods", () => ({ QuickAddFoods: () => null }));

const { MoreSheet } = await import("./MoreSheet");
const { LogMealSheet } = await import("../macro/LogMealSheet");

const MEALS: Meal[] = [{ id: 1, name: "Breakfast", foods: [] }];

// jsdom has no pointer capture; the handle captures the pointer it drags.
beforeAll(() => {
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    value: () => {},
    configurable: true,
  });
});
afterAll(() => {
  Reflect.deleteProperty(Element.prototype, "setPointerCapture");
});

afterEach(() => {
  cleanup();
});

function MoreHarness() {
  return (
    <MoreSheet
      current="plan"
      onSelect={() => {}}
    >
      <button type="button">Open</button>
    </MoreSheet>
  );
}

function LogMealHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
      >
        Open
      </button>
      <LogMealSheet
        open={open}
        onOpenChange={setOpen}
        meals={MEALS}
        dayLabel="Today"
        aiAvailable={false}
        initialMealId={1}
        onMethod={() => {}}
        onQuickLog={() => {}}
      />
    </>
  );
}

const SHEETS = [
  ["More", MoreHarness],
  ["the quick-add launcher", LogMealHarness],
] as const;

async function open(Harness: () => React.JSX.Element) {
  render(<Harness />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
  });
  return screen.getByRole("dialog");
}

function handleOf(dialog: HTMLElement): HTMLElement {
  const handle = dialog.querySelector<HTMLElement>(
    '[data-slot="sheet-handle"]',
  );
  if (!handle) throw new Error("no grab handle");
  return handle;
}

/** The title element (what names the dialog). */
function titleOf(dialog: HTMLElement): HTMLElement {
  const id = dialog.getAttribute("aria-labelledby");
  const title = id ? document.getElementById(id) : null;
  if (!title) throw new Error("no title");
  return title;
}

describe.each(SHEETS)("%s", (_, Harness) => {
  it("has the grab handle and the Close button", async () => {
    const dialog = await open(Harness);
    expect(handleOf(dialog).getAttribute("aria-hidden")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("a long drag down on the handle dismisses it; a short one doesn't", async () => {
    const dialog = await open(Harness);
    const handle = handleOf(dialog);
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 140, pointerId: 1 });
    expect(screen.getByRole("dialog")).toBe(dialog);

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 220, pointerId: 1 });
    await act(async () => {
      fireEvent.pointerUp(handle, { clientY: 220, pointerId: 1 });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Escape dismisses it", async () => {
    const dialog = await open(Harness);
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

it("both sheets set their title and header the same way", async () => {
  const more = await open(MoreHarness);
  const moreTitle = titleOf(more);
  const moreHeader = moreTitle.parentElement?.className;
  const moreTitleClass = moreTitle.className;
  cleanup();
  const log = await open(LogMealHarness);
  const logTitle = titleOf(log);
  expect(logTitle.className).toBe(moreTitleClass);
  expect(logTitle.parentElement?.className).toBe(moreHeader);
});
