// @vitest-environment jsdom
import { ThemeProvider } from "next-themes";
import { readFileSync } from "node:fs";
import path from "node:path";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AppToaster, toasterTheme } from "./app-toaster";
import { MobileBottomNav } from "./shell/MobileBottomNav";

/** jsdom ships no matchMedia; both next-themes and Sonner read
 *  `prefers-color-scheme` through it. The stub reports a DARK OS so the
 *  tests can tell "follows the OS" apart from "follows the app theme". */
function installDarkOs() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === "(prefers-color-scheme: dark)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

beforeEach(installDarkOs);

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.unstubAllGlobals();
});

async function toasterList(): Promise<HTMLElement> {
  act(() => {
    toast("Saved");
  });
  return waitFor(() => {
    const list = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    expect(list).not.toBeNull();
    return list!;
  });
}

describe("toasterTheme", () => {
  it("passes a resolved light/dark theme through", () => {
    expect(toasterTheme("light")).toBe("light");
    expect(toasterTheme("dark")).toBe("dark");
  });

  it("falls back to the OS preference before next-themes resolves", () => {
    expect(toasterTheme(undefined)).toBe("system");
    expect(toasterTheme("system")).toBe("system");
  });
});

describe("AppToaster", () => {
  it("follows a manual Light choice even when the OS is dark", async () => {
    render(
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
      >
        <AppToaster />
      </ThemeProvider>,
    );
    const list = await toasterList();
    expect(list.dataset.sonnerTheme).toBe("light");
  });

  it("follows the OS when the theme is System", async () => {
    render(
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
      >
        <AppToaster />
      </ThemeProvider>,
    );
    const list = await toasterList();
    expect(list.dataset.sonnerTheme).toBe("dark");
  });

  it("offsets toasts by the bottom-nav clearance variable", async () => {
    render(
      <ThemeProvider attribute="class">
        <AppToaster />
      </ThemeProvider>,
    );
    const list = await toasterList();
    expect(list.style.getPropertyValue("--mobile-offset-bottom")).toBe(
      "var(--toast-offset-bottom, 16px)",
    );
    expect(list.style.getPropertyValue("--offset-bottom")).toBe(
      "var(--toast-offset-bottom, 24px)",
    );
  });

  it("gets its clearance only from a mounted, visible mobile tab bar", () => {
    // The variable is set by a :has() rule keyed on the bar's data hook,
    // scoped below `md`, where the bar is visible.
    const css = readFileSync(
      path.join(__dirname, "..", "app", "globals.css"),
      "utf8",
    );
    expect(css).toMatch(
      /@media not all and \(min-width: 48rem\) \{\s*:root:has\(\[data-mobile-bottom-nav\]\) \{\s*--toast-offset-bottom:/,
    );
    render(
      <MobileBottomNav
        current="plan"
        onSelect={() => undefined}
      />,
    );
    expect(
      screen
        .getByRole("navigation", { name: /primary navigation \(mobile\)/i })
        .hasAttribute("data-mobile-bottom-nav"),
    ).toBe(true);
  });
});
