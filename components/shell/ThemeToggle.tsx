"use client";

import { Button } from "@/components/ui/button";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const ORDER = ["system", "light", "dark"] as const;

// Returns `false` during SSR / first render, `true` after hydration —
// without a setState-in-effect that react-hooks/set-state-in-effect flags.
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const current = mounted ? (theme ?? "system") : "system";
  const Icon = current === "dark" ? Moon : current === "light" ? Sun : Monitor;

  const cycle = () => {
    const idx = ORDER.indexOf(current as (typeof ORDER)[number]);
    setTheme(ORDER[(idx + 1) % ORDER.length]);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${current} (click to cycle)`}
      title={`Theme: ${current}`}
      className="h-8 w-8"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
