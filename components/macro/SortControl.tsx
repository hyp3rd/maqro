"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { ArrowDownAZ, Calendar, GripVertical, Tag } from "lucide-react";

/** The four sort modes available on the My Foods / Recipes / Templates
 *  views. "Custom" enables drag-and-drop reordering with the position
 *  persisted per-row; everything else is a derived sort over the loaded
 *  data. */
export type SortMode = "recent" | "name" | "type" | "custom";

/** Active mode lives in per-device localStorage. The user's manual
 *  custom ordering itself is in IDB + Supabase (per-row `sortOrder`),
 *  so dragging on one device shows up on another, but the mode they
 *  prefer to view in stays a local UI preference. */
function readMode(key: string, fallback: SortMode): SortMode {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (
      raw === "recent" ||
      raw === "name" ||
      raw === "type" ||
      raw === "custom"
    ) {
      return raw;
    }
  } catch {
    // localStorage can be unavailable (private mode, quota). Fall back.
  }
  return fallback;
}

function writeMode(key: string, mode: SortMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, mode);
  } catch {
    // Quota / private mode — ignore. The mode just won't persist.
  }
}

/** Returns `[mode, setMode]` with the mode persisted to localStorage.
 *  Use one storage key per list (e.g. `"sort:foods"`, `"sort:recipes"`)
 *  so the views remember independently. */
export function useSortMode(
  storageKey: string,
  fallback: SortMode = "recent",
): [SortMode, (next: SortMode) => void] {
  // Lazy initializer reads localStorage on first render only.
  const [mode, setMode] = useState<SortMode>(() =>
    readMode(storageKey, fallback),
  );
  // If a different tab changes the same key, mirror it.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey || !e.newValue) return;
      if (
        e.newValue === "recent" ||
        e.newValue === "name" ||
        e.newValue === "type" ||
        e.newValue === "custom"
      ) {
        setMode(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);
  function update(next: SortMode) {
    writeMode(storageKey, next);
    setMode(next);
  }
  return [mode, update];
}

const MODE_LABELS: Record<SortMode, { label: string; icon: typeof Tag }> = {
  recent: { label: "Recent", icon: Calendar },
  name: { label: "Name", icon: ArrowDownAZ },
  type: { label: "Type", icon: Tag },
  custom: { label: "Custom", icon: GripVertical },
};

type Props = {
  /** Allowed modes. Some lists (Templates) have no meaningful "type"
   *  field, so the caller picks which subset to expose. */
  modes: ReadonlyArray<SortMode>;
  active: SortMode;
  onChange: (mode: SortMode) => void;
};

/** Compact segmented control rendered on top of each list. Click a
 *  mode to switch sort order. The "Custom" mode unlocks drag-and-drop
 *  in the consumer view. */
export function SortControl({ modes, active, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
      {modes.map((m) => {
        const { label, icon: Icon } = MODE_LABELS[m];
        const isActive = m === active;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={isActive}
            title={`Sort by ${label.toLowerCase()}`}
          >
            <Icon className="h-3 w-3" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Pure helper: apply the active sort to a list. The list type can be
 *  anything that has `name`, `createdAt`, and optionally `sortOrder`
 *  plus a `typeKey` extractor (since "type" means different things on
 *  different lists — `dietKind` for foods, `cuisine` for recipes). */
export function sortByMode<T extends { name: string; createdAt: number }>(
  rows: ReadonlyArray<T>,
  mode: SortMode,
  opts: {
    sortOrder?: (row: T) => number | undefined;
    typeKey?: (row: T) => string | undefined;
    recentField?: (row: T) => number;
  } = {},
): T[] {
  const out = [...rows];
  const recent = opts.recentField ?? ((r) => r.createdAt);
  switch (mode) {
    case "name":
      return out.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    case "type": {
      const typeOf = opts.typeKey ?? (() => "");
      return out.sort((a, b) => {
        const ta = (typeOf(a) ?? "").toLowerCase();
        const tb = (typeOf(b) ?? "").toLowerCase();
        if (ta !== tb) return ta.localeCompare(tb);
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    }
    case "custom": {
      const orderOf = opts.sortOrder ?? (() => undefined);
      return out.sort((a, b) => {
        // Rows the user has positioned use their explicit sortOrder.
        // Rows that haven't been positioned fall back to recent
        // (newest first) so the "custom" view doesn't look empty for
        // legacy rows.
        const oa = orderOf(a);
        const ob = orderOf(b);
        if (oa != null && ob != null) return oa - ob;
        if (oa != null) return -1;
        if (ob != null) return 1;
        return recent(b) - recent(a);
      });
    }
    case "recent":
    default:
      return out.sort((a, b) => recent(b) - recent(a));
  }
}
