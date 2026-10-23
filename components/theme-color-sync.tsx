"use client";

import { THEME_COLOR } from "@/lib/design/palette";
import { useEffect } from "react";
import { useTheme } from "next-themes";

/** The viewport `theme-color` metas (app/layout.tsx) are keyed on
 *  `prefers-color-scheme`, which the server can see but a manual theme
 *  choice (stored client-side by next-themes) cannot change. Once the theme
 *  resolves, point every theme-color meta at the active ground so the
 *  browser chrome matches the page instead of the OS. Renders nothing. */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = THEME_COLOR[resolvedTheme];
    for (const meta of document.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )) {
      meta.content = color;
    }
  }, [resolvedTheme]);

  return null;
}
