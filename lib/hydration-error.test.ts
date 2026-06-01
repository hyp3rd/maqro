import { describe, expect, it } from "vitest";
import {
  extractComponentStack,
  isHydrationError,
  summarizeHydrationArgs,
} from "./hydration-error";

describe("isHydrationError", () => {
  it("matches the dev hydration message", () => {
    expect(
      isHydrationError([
        "Warning: Text content did not match. Server: %s Client: %s",
        "Today",
        "",
      ]),
    ).toBe(true);
  });

  it("matches the React 19 'Hydration failed' message", () => {
    expect(
      isHydrationError([
        "Hydration failed because the server rendered text didn't match the client.",
      ]),
    ).toBe(true);
  });

  it("matches the minified prod error + react.dev link", () => {
    expect(
      isHydrationError([
        new Error(
          "Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message",
        ),
      ]),
    ).toBe(true);
  });

  it("matches the react.dev/errors link anywhere in the args", () => {
    expect(
      isHydrationError(["see https://react.dev/errors/423 for details"]),
    ).toBe(true);
  });

  it("ignores unrelated console.error calls", () => {
    expect(isHydrationError(["Failed to fetch /api/foo", 500])).toBe(false);
    expect(isHydrationError(["some random warning"])).toBe(false);
    expect(isHydrationError([])).toBe(false);
  });
});

describe("extractComponentStack", () => {
  it("picks the arg with the most stack frames", () => {
    const stack =
      "\n    at DateNavigator\n    at MealPlanner\n    at MacroCalculator";
    const out = extractComponentStack(["Hydration failed", "Today", stack]);
    expect(out).toContain("DateNavigator");
    expect(out).toContain("MacroCalculator");
  });

  it("returns undefined when no arg carries a stack (minified prod)", () => {
    expect(
      extractComponentStack([
        new Error("Minified React error #418; visit https://react.dev/..."),
      ]),
    ).toBeUndefined();
  });
});

describe("summarizeHydrationArgs", () => {
  it("joins string args and collapses whitespace", () => {
    const out = summarizeHydrationArgs([
      "Text content did not match.",
      "Server:",
      "Today",
    ]);
    expect(out).toBe("Text content did not match. Server: Today");
  });

  it("includes Error messages and caps length", () => {
    const long = "x".repeat(500);
    const out = summarizeHydrationArgs([new Error(long)]);
    expect(out.length).toBe(300);
  });
});
