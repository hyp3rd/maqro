"use client";

import { useUser } from "@/hooks/use-user";
import { useSyncMode } from "@/lib/sync-mode";
import { HardDrive, RefreshCw, Timer } from "lucide-react";
import type { ViewKey } from "./Sidebar";

const META = {
  "local-first": {
    icon: HardDrive,
    short: "Local",
    title:
      "Sync: Local-first — edits stay on this device until you save. Tap to change.",
  },
  "auto-save": {
    icon: Timer,
    short: "Auto",
    title: "Sync: Auto-save — pushes on a timer while pending. Tap to change.",
  },
  "remote-only": {
    icon: RefreshCw,
    short: "Live",
    title:
      "Sync: Always sync — pushes shortly after every change. Tap to change.",
  },
} as const;

/** Compact topbar chip showing the active sync mode (set in
 *  Settings → Sync), sitting next to the SyncStatusPill. Tapping it
 *  jumps to Settings to change the mode. Signed-in only — sync (and so
 *  the mode) is meaningless for a guest. */
export function SyncModeIndicator({
  onSelectView,
}: {
  onSelectView?: (key: ViewKey) => void;
}) {
  const { user } = useUser();
  const { mode, intervalMinutes } = useSyncMode();

  if (!user) return null;

  const meta = META[mode];
  const Icon = meta.icon;
  const label =
    mode === "auto-save" ? `Auto · ${intervalMinutes}m` : meta.short;

  return (
    <button
      type="button"
      onClick={() => onSelectView?.("settings")}
      title={meta.title}
      aria-label={`Sync mode: ${label}. Tap to change.`}
      className="flex h-9 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
