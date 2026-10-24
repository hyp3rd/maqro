"use client";

import { useTheme } from "next-themes";
import { Toaster, type ToasterProps } from "sonner";

/** Sonner's `"system"` mode reads `prefers-color-scheme`, not the `.dark`
 *  class next-themes toggles, so a manual Light/Dark choice was ignored.
 *  Follow the resolved theme instead; before next-themes resolves (SSR and
 *  the first client render) fall back to `"system"`, which matches what
 *  next-themes itself resolves to by default. */
export function toasterTheme(
  resolvedTheme: string | undefined,
): NonNullable<ToasterProps["theme"]> {
  return resolvedTheme === "light" || resolvedTheme === "dark"
    ? resolvedTheme
    : "system";
}

/** Bottom offsets read `--toast-offset-bottom`, which app/globals.css sets
 *  only while the mobile tab bar is visible, so toasts clear it. Otherwise
 *  the fallbacks are Sonner's own defaults (24px viewport / 16px mobile). */
const OFFSET = { bottom: "var(--toast-offset-bottom, 24px)" } as const;
const MOBILE_OFFSET = { bottom: "var(--toast-offset-bottom, 16px)" } as const;

export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="bottom-center"
      // Semantic green / red for success / error variants.
      richColors
      closeButton
      theme={toasterTheme(resolvedTheme)}
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
    />
  );
}
