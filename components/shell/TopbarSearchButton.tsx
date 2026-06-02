"use client";

import { openCommandPalette } from "@/lib/command-palette-bus";
import * as React from "react";
import { Search } from "lucide-react";

/** A search-input-shaped button that opens the global
 *  [CommandPalette](./CommandPalette.tsx). The palette is also
 *  bound to Cmd-K / Ctrl-K, but the affordance only exists in
 *  muscle memory — this button makes the feature discoverable
 *  to users who'd never guess the shortcut.
 *
 *  Detects the visitor's platform to render the right modifier
 *  hint (`⌘K` on macOS / iOS, `Ctrl K` everywhere else). Resolves
 *  client-side after mount so the SSR HTML has a neutral fallback
 *  and there's no flash. */
/** macOS / iOS detection — runs once at module init on the client.
 *  Returns `null` on the server so the SSR pass renders nothing
 *  platform-specific; hydration replaces it with the resolved
 *  value on the first client render. `navigator.platform` is
 *  deprecated but still the most reliable cross-browser signal;
 *  `navigator.userAgentData.platform` isn't universally available. */
function detectMac(): boolean | null {
  if (typeof navigator === "undefined") return null;
  const platform =
    navigator.platform || (navigator as { userAgent?: string }).userAgent || "";
  return /mac|ipod|iphone|ipad/i.test(platform);
}

export function TopbarSearchButton() {
  const [isMac] = React.useState<boolean | null>(detectMac);

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Search (Cmd-K)"
      className="group inline-flex h-8 items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground sm:w-56 sm:justify-between"
    >
      <span className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search or jump to…</span>
      </span>
      {/* Modifier hint. The kbd group is hidden until the platform
          resolves so we don't flash the wrong shortcut on first
          paint. */}
      {isMac !== null && (
        <span className="hidden items-center gap-0.5 sm:flex">
          <kbd className="rounded border border-border/60 bg-background px-1.5 py-px font-mono text-[10px] font-medium text-muted-foreground">
            {isMac ? "⌘" : "Ctrl"}
          </kbd>
          <kbd className="rounded border border-border/60 bg-background px-1.5 py-px font-mono text-[10px] font-medium text-muted-foreground">
            K
          </kbd>
        </span>
      )}
    </button>
  );
}
