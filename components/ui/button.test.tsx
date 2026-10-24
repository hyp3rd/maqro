/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button, buttonVariants } from "./button";

afterEach(() => cleanup());

const SIZES = ["xs", "sm", "default", "lg", "icon", "icon-sm"] as const;

/** Height/width classes in a class string, coarse-pointer variants included. */
function sizeClasses(classes: string, axis: "h" | "w"): string[] {
  return classes
    .split(/\s+/)
    .filter((c) => new RegExp(`^(coarse:)?(${axis}|size)-`).test(c));
}

/** True when the classes resolve to >= 44px on a coarse pointer: a
 *  `touch-*` size (floored at 44px there) or a fixed size of 11+ (44px). */
function reaches44OnCoarse(classes: string[]): boolean {
  return classes.some((c) => {
    const value = c.replace(/^(coarse:)?(h|w|size)-/, "");
    if (value.startsWith("touch-")) return true;
    const n = Number(value);
    return Number.isFinite(n) && n >= 11;
  });
}

describe("Button size scale", () => {
  it.each(SIZES)("size %s reaches 44px tall on coarse pointers", (size) => {
    expect(reaches44OnCoarse(sizeClasses(buttonVariants({ size }), "h"))).toBe(
      true,
    );
  });

  it.each(["icon", "icon-sm"] as const)(
    "size %s is also 44px wide on coarse pointers",
    (size) => {
      expect(
        reaches44OnCoarse(sizeClasses(buttonVariants({ size }), "w")),
      ).toBe(true);
    },
  );

  it("keeps the existing desktop heights of sm / default / lg / icon", () => {
    // touch-N is h-N on a fine pointer; these names were already in use at
    // ~200 call sites, so their desktop size must not move.
    expect(buttonVariants({ size: "sm" })).toContain("h-touch-9");
    expect(buttonVariants({ size: "default" })).toContain("h-touch-10");
    expect(buttonVariants({ size: "lg" })).toContain("h-11");
    expect(buttonVariants({ size: "icon" })).toContain("h-11 w-11");
  });

  it("lets a call site's plain height override replace the touch size", () => {
    render(
      <Button
        size="sm"
        className="h-8"
      >
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("h-8");
    expect(button.className).not.toContain("h-touch-9");
  });

  it("keeps a call site's own coarse bump alongside its override", () => {
    render(
      <Button
        size="sm"
        className="h-8 coarse:h-10"
      >
        Add
      </Button>,
    );
    const { className } = screen.getByRole("button", { name: "Add" });
    expect(className).toContain("h-8");
    expect(className).toContain("coarse:h-10");
    expect(className).not.toContain("h-touch-9");
  });
});

describe("Button brand variant", () => {
  it("fills with the text-safe brand fill and its foreground", () => {
    render(<Button variant="brand">Upgrade</Button>);
    const { className } = screen.getByRole("button", { name: "Upgrade" });
    expect(className).toContain("bg-brand-strong");
    expect(className).toContain("text-brand-foreground");
  });
});
