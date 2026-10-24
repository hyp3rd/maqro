import tailwindConfig from "@/tailwind.config.mjs";
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

const namedSizes = Object.keys(
  (tailwindConfig.theme?.extend?.fontSize ?? {}) as Record<string, unknown>,
);

describe("cn", () => {
  it("covers the configured named font sizes", () => {
    expect(namedSizes).toEqual(expect.arrayContaining(["label", "2xs", "3xs"]));
  });

  it.each(namedSizes)("keeps text-%s next to a text colour", (size) => {
    expect(cn(`text-${size}`, "text-muted-foreground")).toBe(
      `text-${size} text-muted-foreground`,
    );
  });

  it.each(namedSizes)("resolves text-sm then text-%s to the latter", (size) => {
    expect(cn("text-sm", `text-${size}`)).toBe(`text-${size}`);
  });

  it.each(namedSizes)("resolves text-%s then text-sm to the latter", (size) => {
    expect(cn(`text-${size}`, "text-sm")).toBe("text-sm");
  });

  it("still resolves text colour conflicts", () => {
    expect(cn("text-label text-muted-foreground", "text-foreground")).toBe(
      "text-label text-foreground",
    );
  });
});

const touchSizes = Object.keys(
  (tailwindConfig.theme?.extend?.spacing ?? {}) as Record<string, unknown>,
).filter((key) => key.startsWith("touch-"));

describe("cn with the pointer-aware touch sizes", () => {
  it("covers the configured touch sizes", () => {
    expect(touchSizes).toEqual(
      expect.arrayContaining(["touch-7", "touch-8", "touch-9", "touch-10"]),
    );
  });

  // A call site that overrides a primitive's height must replace the touch
  // size outright (including its coarse-pointer floor), exactly as it
  // replaced the plain height before.
  it.each(touchSizes)("lets a plain size override %s", (size) => {
    expect(cn(`h-${size}`, "h-7")).toBe("h-7");
    expect(cn(`w-${size}`, "w-7")).toBe("w-7");
    expect(cn(`min-h-${size}`, "min-h-0")).toBe("min-h-0");
  });

  it.each(touchSizes)("lets %s override a plain height", (size) => {
    expect(cn("h-9", `h-${size}`)).toBe(`h-${size}`);
  });
});
