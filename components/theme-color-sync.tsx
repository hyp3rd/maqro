"use client";

import { THEME_COLOR } from "@/lib/design/palette";
import { useEffect } from "react";
import { useTheme } from "next-themes";

const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';

function applyThemeColor(color: string) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    THEME_COLOR_SELECTOR,
  )) {
    if (meta.content !== color) meta.content = color;
  }
}

/** The viewport `theme-color` metas (app/layout.tsx) carry a
 *  `prefers-color-scheme` media query, which the browser evaluates against
 *  the OS setting; a manual theme choice (stored client-side by next-themes)
 *  cannot change it. Once the theme resolves, point every theme-color meta
 *  at the active ground so the browser chrome matches the page instead of
 *  the OS.
 *
 *  Next re-renders the viewport metas on every client navigation under a
 *  per-request key, so React replaces them with fresh OS-keyed copies while
 *  the resolved theme stays the same. A MutationObserver on `<head>`
 *  re-applies the colour whenever metas are added. Renders nothing. */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = THEME_COLOR[resolvedTheme];
    applyThemeColor(color);

    // Only childList is observed: setting `content` is an attribute
    // mutation, so re-applying cannot retrigger the observer.
    const observer = new MutationObserver((records) => {
      const metaAdded = records.some((record) =>
        [...record.addedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches(THEME_COLOR_SELECTOR) ||
              node.querySelector(THEME_COLOR_SELECTOR) !== null),
        ),
      );
      if (metaAdded) applyThemeColor(color);
    });
    observer.observe(document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  return null;
}
