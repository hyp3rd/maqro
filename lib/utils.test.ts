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
