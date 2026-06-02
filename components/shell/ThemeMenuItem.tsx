"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useMounted } from "@/hooks/use-mounted";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const ORDER = ["system", "light", "dark"] as const;
const LABEL = { system: "System", light: "Light", dark: "Dark" } as const;

/** Theme cycler as a dropdown row, for the mobile avatar menu (where the
 *  standalone ThemeToggle button no longer fits the topbar). Selecting it
 *  advances system → light → dark and, via `preventDefault`, keeps the
 *  menu open so the user can step through the cycle without re-opening. */
export function ThemeMenuItem() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  // Normalize to the known cycle so indexing LABEL/ORDER stays typed
  // (next-themes hands back a bare string). Anything unexpected — or the
  // pre-hydration render — falls back to "system".
  const raw = mounted ? (theme ?? "system") : "system";
  const current: (typeof ORDER)[number] =
    raw === "light" || raw === "dark" ? raw : "system";
  const Icon = current === "dark" ? Moon : current === "light" ? Sun : Monitor;

  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        const idx = ORDER.indexOf(current);
        setTheme(ORDER[(idx + 1) % ORDER.length]);
      }}
      className="gap-2"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="flex-1">Theme</span>
      <span className="text-xs text-muted-foreground">{LABEL[current]}</span>
    </DropdownMenuItem>
  );
}
