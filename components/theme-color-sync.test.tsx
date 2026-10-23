// @vitest-environment jsdom
import { THEME_COLOR } from "@/lib/design/palette";
import { ThemeProvider, useTheme } from "next-themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeColorSync } from "./theme-color-sync";

/** jsdom ships no matchMedia; next-themes reads `prefers-color-scheme`
 *  through it. Report a light OS. */
function installLightOs() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
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

/** The two metas Next renders from `viewport.themeColor`. */
function installThemeColorMetas() {
  for (const scheme of ["light", "dark"] as const) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.media = `(prefers-color-scheme: ${scheme})`;
    meta.content = THEME_COLOR[scheme];
    document.head.append(meta);
  }
}

const metaContents = () =>
  [
    ...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  ].map((m) => m.content);

/** Stands in for the theme menu: one button per choice. */
function ThemeButtons() {
  const { setTheme } = useTheme();
  return (
    <>
      {["light", "system"].map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTheme(t)}
        >
          {t}
        </button>
      ))}
    </>
  );
}

beforeEach(() => {
  installLightOs();
  installThemeColorMetas();
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ThemeColorSync", () => {
  it("retargets every theme-color meta to a manual Dark choice", () => {
    render(
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
      >
        <ThemeColorSync />
      </ThemeProvider>,
    );
    expect(metaContents()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
  });

  it("follows later theme changes", () => {
    render(
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
      >
        <ThemeButtons />
        <ThemeColorSync />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(metaContents()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
    fireEvent.click(screen.getByRole("button", { name: "system" }));
    // System on a light OS resolves to light.
    expect(metaContents()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });
});
