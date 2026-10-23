/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Checkbox } from "./checkbox";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

afterEach(() => cleanup());

// Overlay close buttons used to be the bare 16px icon. They are now a
// 32px target on a precise pointer and 44px (`touch-8`) on a finger.
describe("overlay close buttons", () => {
  it("Dialog close is a touch-sized target", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Edit food</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("h-touch-8");
    expect(close.className).toContain("w-touch-8");
  });

  it.each(["right", "bottom"] as const)(
    "Sheet (%s) close is a touch-sized target",
    (side) => {
      render(
        <Sheet open>
          <SheetContent
            side={side}
            aria-describedby={undefined}
          >
            <SheetTitle>Notifications</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      const close = screen.getByRole("button", { name: "Close" });
      expect(close.className).toContain("h-touch-8");
      expect(close.className).toContain("w-touch-8");
      // Edge-anchored sheets still clear the notch.
      expect(close.className).toContain(
        side === "bottom" ? "top-2" : "top-safe-2",
      );
    },
  );
});

describe("Checkbox", () => {
  it("keeps its 16px box on a precise pointer", () => {
    render(<Checkbox aria-label="Include eggs" />);
    const box = screen.getByRole("checkbox", { name: "Include eggs" });
    expect(box.className).toContain("h-4 w-4");
  });

  it("grows the box and pads the hit area to 44px on coarse pointers", () => {
    render(<Checkbox aria-label="Include eggs" />);
    const { className } = screen.getByRole("checkbox", {
      name: "Include eggs",
    });
    // jsdom has no layout, so this pins the mechanism rather than the
    // pixels: a 20px box plus an invisible ::after sized to the touch
    // token and centred on the box. An inset ::after would be measured
    // from the padding box (18px inside the 1px border) and fall short.
    expect(className).toContain("coarse:h-5 coarse:w-5");
    expect(className).toContain("relative");
    expect(className).toContain("coarse:after:absolute");
    expect(className).toContain("coarse:after:size-(--touch-target-min)");
    expect(className).toContain("coarse:after:left-1/2");
    expect(className).toContain("coarse:after:top-1/2");
    expect(className).toContain("coarse:after:-translate-1/2");
    expect(className).not.toMatch(/coarse:after:-?inset/);
  });
});
