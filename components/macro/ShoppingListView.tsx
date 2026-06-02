"use client";

import { SwipeRow } from "@/components/gestures/SwipeRow";
import { Button } from "@/components/ui/button";
import {
  addPantryItem,
  listDailyLogs,
  listPantryItems,
  listShoppingListMeta,
  todayKey,
  upsertPantryItem,
  upsertShoppingListMeta,
  type DailyLog,
  type PantryItem,
  type ShoppingListMeta,
} from "@/lib/db";
import {
  buildDisplayItems,
  computeShoppingList,
  nameKey as sharedNameKey,
  type DisplayItem,
  type ShoppingItem,
} from "@/lib/shopping-list";
import {
  AISLE_COLORS,
  categorizeFallback,
  SHOPPING_AISLES,
  type ShoppingAisle,
} from "@/lib/shopping/categorize";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useMemo, useState } from "react";
import {
  Apple,
  Beef,
  Box,
  ChevronRight,
  Copy,
  Croissant,
  CupSoda,
  Egg,
  FileDown,
  GripVertical,
  Package,
  PackagePlus,
  ShoppingCart,
  Snowflake,
  SprayCan,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FavoriteStores } from "./FavoriteStores";
import { NearbyStores } from "./NearbyStores";
import { ShoppingItemSheet } from "./ShoppingItemSheet";

const nameKey = sharedNameKey;

/** Per-aisle icon used as a visual marker on each section header.
 *  Kept small + monochrome so the list still scans at a glance —
 *  the icon disambiguates the section, the row text stays primary.
 *  Falls back to `Box` for any aisle that doesn't map (defensive;
 *  the SHOPPING_AISLES enum is the single source of truth). */
const AISLE_ICON: Record<ShoppingAisle, LucideIcon> = {
  Produce: Apple,
  "Dairy & Eggs": Egg,
  "Meat & Seafood": Beef,
  Bakery: Croissant,
  "Pantry & Dry Goods": Package,
  Frozen: Snowflake,
  Beverages: CupSoda,
  Household: SprayCan,
  Other: Box,
};

/** Range presets surfaced as pills above the list. The "Today" /
 *  "This week" / "Next 7 days" / "Last 7 days" set covers the
 *  realistic shopping-list use cases:
 *
 *    - Today  — quick scan of what's on the plate now
 *    - Next 7 days — the canonical "plan a grocery run for the week"
 *    - This week — Mon-Sun current calendar week
 *    - Last 7 days — see what you ate, useful for "buy more of X"
 *
 *  Custom ranges via the date inputs come later if usage demands. */
type Preset = "today" | "this-week" | "next-7" | "last-7";

const PRESET_LABELS: Record<Preset, string> = {
  today: "Today",
  "this-week": "This week",
  "next-7": "Next 7 days",
  "last-7": "Last 7 days",
};

/** Rows per page in the shopping list. Matches the pantry + MyFoodsView. */
const PAGE_SIZE = 20;

function presetRange(
  preset: Preset,
  today: string,
): { start: string; end: string } {
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "next-7":
      return { start: today, end: addDays(today, 6) };
    case "last-7":
      return { start: addDays(today, -6), end: today };
    case "this-week": {
      // Monday-anchored. Postgres-style ISO week numbering would
      // be more correct but this is a shopping list, not a payroll
      // report — Mon → Sun is what most users expect.
      const [y, m, d] = today.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay(); // 0 = Sun, 1 = Mon, ...
      // Walk back to Monday (or 0 if today is Sunday → 6 days back).
      const back = dow === 0 ? 6 : dow - 1;
      return { start: addDays(today, -back), end: addDays(today, 6 - back) };
    }
  }
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = (dt.getMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Friendly day label — "Mon May 15" for the date-range banner. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type Props = {
  /** Switch the app to the Meal Plan view. Surfaced from the empty
   *  state's CTA so a fresh user can jump straight to where they
   *  populate the data this view aggregates. Optional. */
  onGoToPlan?: () => void;
};

export function ShoppingListView({ onGoToPlan }: Props = {}) {
  const [logs, setLogs] = useState<DailyLog[] | null>(null);
  const [preset, setPreset] = useState<Preset>("next-7");
  // Check-off state is intentionally NOT persisted — opening the
  // view shows a fresh list every time. Persisting would create the
  // "old ticks still here from last week" anti-pattern; if the user
  // wants to skip already-bought items they can just not look at
  // them.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  /** Per-item user overrides, keyed by `nameKey(name)`. Drives the
   *  effective-category resolution chain AND surfaces notes under
   *  the row. Updates lazily on the data bus, so a drag in one tab
   *  re-renders the other tab on the next sync tick. */
  const [meta, setMeta] = useState<Map<string, ShoppingListMeta>>(new Map());
  /** Pantry items indexed by `nameKey(name)` so the resolver can
   *  borrow the user's existing aisle choice for items they've
   *  curated into the pantry — "if I already set Olive Oil to
   *  Pantry & Dry Goods in the pantry, the shopping list should
   *  show it there too without me dragging again." */
  const [pantryByName, setPantryByName] = useState<Map<string, PantryItem>>(
    new Map(),
  );
  /** Which row's action sheet is open, by item name. The sheet hosts
   *  all per-item editing (quantity, note, send-to-pantry, remove) so
   *  the row itself stays a clean tap target — matching the pantry /
   *  meal-log grids. Keyed by name (not the DisplayItem) so the sheet
   *  reflects live edits after each save. */
  const [sheetItemName, setSheetItemName] = useState<string | null>(null);
  /** The item the user is currently dragging — drives the
   *  `DragOverlay` so the dragged card visibly follows the cursor
   *  across the screen. Without this, `useDraggable` flags the
   *  source row with `isDragging` (just an opacity change) but
   *  nothing actually moves with the cursor, leaving the user
   *  guessing whether the drag took. */
  const [activeDragItem, setActiveDragItem] = useState<DisplayItem | null>(
    null,
  );

  const dailyLogsRev = useDataRev("dailyLogs");
  const metaRev = useDataRev("shoppingListMeta");
  const pantryRev = useDataRev("pantryItems");

  useEffect(() => {
    let cancelled = false;
    listDailyLogs()
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dailyLogsRev]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listShoppingListMeta(), listPantryItems()])
      .then(([metaRows, pantryRows]) => {
        if (cancelled) return;
        setMeta(new Map(metaRows.map((m) => [m.name, m])));
        setPantryByName(new Map(pantryRows.map((p) => [nameKey(p.name), p])));
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [metaRev, pantryRev]);

  const today = todayKey();
  const { start, end } = presetRange(preset, today);
  const items = useMemo<ShoppingItem[]>(
    () => (logs ? computeShoppingList(logs, start, end) : []),
    [logs, start, end],
  );

  /** Merge the computed items with any manual extras the user has
   *  sent in from a pantry low-stock row. Extras whose names already
   *  appear in the computed set are skipped (no duplicate row — the
   *  computed totals are the more useful number; the extra was just
   *  a "remind me to buy this" signal). Display name for an extra
   *  falls back to the matching pantry item's original casing, or to
   *  a title-cased reconstruction if the pantry entry was deleted.
   *  Computed first so the natural sort (biggest first) of the meal
   *  log aggregator is preserved at the top of each aisle. */
  const displayItems = useMemo<DisplayItem[]>(
    () => buildDisplayItems(items, meta, pantryByName),
    [items, meta, pantryByName],
  );

  /** How many computed items in this range the user has hidden via
   *  the delete X. Drives the "N hidden — show" footer; we don't
   *  count globally-excluded names that aren't in the current range
   *  because the "show" affordance only makes sense for rows the
   *  user would otherwise see right now. */
  const hiddenCount = useMemo(() => {
    let n = 0;
    for (const it of items) {
      if (meta.get(nameKey(it.name))?.excluded) n += 1;
    }
    return n;
  }, [items, meta]);

  // Range changes → wipe ticks so the user isn't confused by stale
  // checkmarks bleeding across ranges. Done via the "reset state
  // during render" pattern (a useEffect-based reset would trip
  // react-hooks/set-state-in-effect).
  const rangeKey = `${preset}|${start}|${end}`;
  const [prevRangeKey, setPrevRangeKey] = useState(rangeKey);
  if (prevRangeKey !== rangeKey) {
    setPrevRangeKey(rangeKey);
    setChecked(new Set());
    setPage(0);
  }

  // Client-side pagination over the displayed list (computed +
  // extras). Check-off state is keyed by item name, so it survives
  // paging.
  const totalPages = Math.max(1, Math.ceil(displayItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () => displayItems.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [displayItems, safePage],
  );

  /** Resolve the aisle for an item using a three-step chain:
   *
   *    1. A user override from the shoppingListMeta store. Wins
   *       always — set by dragging the item across sections.
   *    2. A pantry item with the same lowercased name that has a
   *       user-chosen category. If the user picked an aisle for
   *       this food in the pantry, the shopping list should respect
   *       that without making them drag the same row twice.
   *    3. The deterministic `categorizeFallback` rule.
   *
   *  Memoised inline at the grouping call site below so meta /
   *  pantry updates trigger a re-bucket, not just a re-render. */
  const groupedByAisle = useMemo(() => {
    const buckets = new Map<ShoppingAisle, DisplayItem[]>();
    for (const item of paged) {
      const key = nameKey(item.name);
      const overrideAisle = meta.get(key)?.category;
      const pantryAisle = pantryByName.get(key)?.category;
      const aisle =
        overrideAisle ?? pantryAisle ?? categorizeFallback(item.name);
      const existing = buckets.get(aisle);
      if (existing) existing.push(item);
      else buckets.set(aisle, [item]);
    }
    return SHOPPING_AISLES.flatMap((aisle) => {
      const rows = buckets.get(aisle);
      return rows ? [{ aisle, rows }] : [];
    });
  }, [paged, meta, pantryByName]);

  /** DnD sensors. Same activation distance pattern as Recipes /
   *  Templates — click on the checkbox or note button doesn't start
   *  a drag unless the pointer moves 6 px first. KeyboardSensor
   *  lets keyboard-only users move items between aisles (Tab to
   *  the grip, Space to pick up, arrow keys to traverse drop
   *  targets, Space again to drop, Esc to cancel). */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  /** Handle a drop. The droppable's `data` carries the target aisle
   *  (set on each section's useDroppable below). If the user dragged
   *  the item into a different section than it currently lives in,
   *  persist the override; if they dropped it on the same section,
   *  ignore. */
  function handleDragStart(event: DragStartEvent) {
    const name = (event.active.data.current as { name?: string } | undefined)
      ?.name;
    if (!name) return;
    const found = displayItems.find((it) => it.name === name);
    if (found) setActiveDragItem(found);
  }

  function handleDragCancel() {
    setActiveDragItem(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragItem(null);
    const { active, over } = event;
    if (!over) return;
    const targetAisle = (
      over.data.current as { aisle?: ShoppingAisle } | undefined
    )?.aisle;
    const itemName = active.data.current as { name?: string } | undefined;
    if (!targetAisle || !itemName?.name) return;
    const key = nameKey(itemName.name);
    const currentAisle =
      meta.get(key)?.category ??
      pantryByName.get(key)?.category ??
      categorizeFallback(itemName.name);
    if (currentAisle === targetAisle) return;
    try {
      await upsertShoppingListMeta(itemName.name, { category: targetAisle });
      // Optimistic update — the data-bus rev triggers the canonical
      // refresh on the next tick.
      setMeta((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        next.set(key, {
          name: key,
          category: targetAisle,
          notes: existing?.notes,
          updatedAt: Date.now(),
        });
        return next;
      });
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't move the item. Try again.");
    }
  }

  async function saveNote(item: DisplayItem, note: string) {
    const itemName = item.name;
    const trimmed = note.trim();
    try {
      await upsertShoppingListMeta(itemName, { notes: trimmed });
      const key = nameKey(itemName);
      setMeta((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        next.set(key, {
          name: key,
          category: existing?.category,
          notes: trimmed || undefined,
          updatedAt: Date.now(),
        });
        return next;
      });
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't save the note. Try again.");
    }
  }

  function toggle(name: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /** Save a qty edit from the action sheet. Routes to `extraQty` for
   *  extras (their source of truth) or `qtyOverride` /
   *  `appearancesOverride` for computed rows (preserving the original
   *  aggregates). An empty / zero / NaN value on a computed row clears
   *  the corresponding override and reverts to the underlying value. */
  async function saveQty(
    item: DisplayItem,
    gramsStr: string,
    countStr: string,
  ) {
    const parsedQty = Number.parseFloat(gramsStr.replace(",", ".").trim());
    const qtyValid = Number.isFinite(parsedQty) && parsedQty > 0;
    const key = nameKey(item.name);
    try {
      if (item.isExtra) {
        // Extras require a qty; clearing would orphan the row — keep
        // the existing value rather than saving an empty one.
        if (!qtyValid) return;
        const rounded = Math.round(parsedQty * 1000) / 1000;
        await upsertShoppingListMeta(item.name, { extraQty: rounded });
        setMeta((prev) => {
          const next = new Map(prev);
          const m = next.get(key);
          if (m) {
            next.set(key, { ...m, extraQty: rounded, updatedAt: Date.now() });
          }
          return next;
        });
      } else {
        const qtyRounded = qtyValid
          ? Math.round(parsedQty * 1000) / 1000
          : null;
        const parsedCount = Number.parseInt(countStr.trim(), 10);
        const countValid = Number.isFinite(parsedCount) && parsedCount > 0;
        const countRounded = countValid ? parsedCount : null;
        await upsertShoppingListMeta(item.name, {
          qtyOverride: qtyRounded,
          appearancesOverride: countRounded,
        });
        setMeta((prev) => {
          const next = new Map(prev);
          const existing = next.get(key);
          next.set(key, {
            ...(existing ?? { name: key }),
            qtyOverride: qtyRounded ?? undefined,
            appearancesOverride: countRounded ?? undefined,
            updatedAt: Date.now(),
          });
          return next;
        });
      }
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't save the quantity. Try again.");
    }
  }

  /** "I bought this — add to pantry." Tops up an existing pantry
   *  item when the units match, or creates a fresh pantry row when
   *  the item isn't there yet. Unit mismatches don't auto-top-up:
   *  adding 200 g to a pantry item measured in "eggs" would be
   *  silently wrong, so we bail out with a clear toast instead.
   *  Sending an extra (a "restock" row) also clears its meta entry
   *  so the line drops out of the shopping list. */
  async function sendToPantry(it: DisplayItem) {
    const key = nameKey(it.name);
    const existing = pantryByName.get(key);
    const addQty = it.totalGrams;
    const addUnit = it.isExtra ? (it.extraUnit ?? "g") : "g";
    try {
      if (existing) {
        if (existing.unit !== addUnit) {
          toast.error(
            `${existing.name} in pantry uses "${existing.unit}", can't auto-add ${addQty} ${addUnit}. Open the pantry to update by hand.`,
          );
          return;
        }
        const newQuantity =
          Math.round((existing.quantity + addQty) * 1000) / 1000;
        await upsertPantryItem({ ...existing, quantity: newQuantity });
        toast.success(
          `+${addQty} ${addUnit} of ${existing.name} added to pantry`,
        );
      } else {
        await addPantryItem({ name: it.name, quantity: addQty, unit: addUnit });
        toast.success(`${it.name} added to pantry`);
      }
      if (it.isExtra) {
        await upsertShoppingListMeta(it.name, {
          extraQty: null,
          extraUnit: null,
        });
        setMeta((prev) => {
          const next = new Map(prev);
          const m = next.get(key);
          if (m) {
            next.set(key, {
              ...m,
              extraQty: undefined,
              extraUnit: undefined,
              updatedAt: Date.now(),
            });
          }
          return next;
        });
      }
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't send to pantry. Try again.");
    }
  }

  /** Remove an item from the shopping list. For an extra ("Restock"
   *  row), clear the `extraQty` so the row vanishes; the meta entry
   *  itself can still exist (it might carry a category override the
   *  user wants to keep for a future re-add). For a computed row,
   *  set `excluded` — the row is filtered out next render and stays
   *  hidden across range changes; the "N hidden — show" footer is
   *  the escape hatch. */
  async function removeFromList(item: DisplayItem) {
    const key = nameKey(item.name);
    // Snapshot so the undo toast can put the row back exactly.
    const prior = meta.get(key);
    try {
      if (item.isExtra) {
        await upsertShoppingListMeta(item.name, {
          extraQty: null,
          extraUnit: null,
        });
        setMeta((prev) => {
          const next = new Map(prev);
          const m = next.get(key);
          if (m) {
            next.set(key, {
              ...m,
              extraQty: undefined,
              extraUnit: undefined,
              updatedAt: Date.now(),
            });
          }
          return next;
        });
      } else {
        await upsertShoppingListMeta(item.name, { excluded: true });
        setMeta((prev) => {
          const next = new Map(prev);
          const existing = next.get(key);
          next.set(key, {
            name: key,
            category: existing?.category,
            notes: existing?.notes,
            extraQty: existing?.extraQty,
            extraUnit: existing?.extraUnit,
            qtyOverride: existing?.qtyOverride,
            excluded: true,
            updatedAt: Date.now(),
          });
          return next;
        });
      }
      toast.success(`Removed ${item.name}`, {
        action: { label: "Undo", onClick: () => void undoRemove(item, prior) },
      });
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't remove the item. Try again.");
    }
  }

  /** Reverse a `removeFromList`: extras get their quantity back,
   *  computed rows clear the `excluded` flag. Driven by the undo toast. */
  async function undoRemove(
    item: DisplayItem,
    prior: ShoppingListMeta | undefined,
  ) {
    const key = nameKey(item.name);
    try {
      if (item.isExtra) {
        const qty = prior?.extraQty ?? item.totalGrams;
        const unit = prior?.extraUnit ?? item.extraUnit ?? "g";
        await upsertShoppingListMeta(item.name, {
          extraQty: qty,
          extraUnit: unit,
        });
        setMeta((prev) => {
          const next = new Map(prev);
          const m = next.get(key) ?? { name: key, updatedAt: Date.now() };
          next.set(key, {
            ...m,
            extraQty: qty,
            extraUnit: unit,
            updatedAt: Date.now(),
          });
          return next;
        });
      } else {
        await upsertShoppingListMeta(item.name, { excluded: null });
        setMeta((prev) => {
          const next = new Map(prev);
          const m = next.get(key);
          if (m) {
            next.set(key, { ...m, excluded: undefined, updatedAt: Date.now() });
          }
          return next;
        });
      }
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't restore the item. Try again.");
    }
  }

  /** Reset every `excluded` flag for items in the current range —
   *  the "show hidden" footer's action. Touches only meta rows that
   *  match the visible computed list so the user's exclusions of
   *  things outside the range (e.g. a regularly-deleted item that
   *  isn't logged this week) are preserved. */
  async function unhideAll() {
    const namesToRestore = items
      .map((it) => it.name)
      .filter((n) => meta.get(nameKey(n))?.excluded);
    try {
      await Promise.all(
        namesToRestore.map((name) =>
          upsertShoppingListMeta(name, { excluded: null }),
        ),
      );
      setMeta((prev) => {
        const next = new Map(prev);
        for (const n of namesToRestore) {
          const k = nameKey(n);
          const m = next.get(k);
          if (m) {
            next.set(k, { ...m, excluded: undefined, updatedAt: Date.now() });
          }
        }
        return next;
      });
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't restore items. Try again.");
    }
  }

  function clearChecks() {
    setChecked(new Set());
  }

  /** Build a plain-text version of the list and copy to clipboard.
   *  Handy for pasting into a notes app, a partner's message
   *  thread, or wherever the user actually does their shopping.
   *
   *  Layout: header → blank line → per-aisle section (aisle name
   *  underlined-style + items + optional indented note). Mirrors the
   *  on-screen grouping so the printed list reads the same as the
   *  app and the user's aisle moves + notes survive the copy. */
  async function copyAsText() {
    const lines: string[] = [
      `Shopping list (${PRESET_LABELS[preset]}, ${dayLabel(start)} → ${dayLabel(end)})`,
      "",
    ];
    // Build groups across the FULL display set (computed + extras,
    // qty overrides applied) so a Cmd+A of the in-app text and a
    // copy match. Same resolver chain as the on-screen group.
    const buckets = new Map<ShoppingAisle, DisplayItem[]>();
    for (const item of displayItems) {
      const key = nameKey(item.name);
      const aisle =
        meta.get(key)?.category ??
        pantryByName.get(key)?.category ??
        categorizeFallback(item.name);
      const existing = buckets.get(aisle);
      if (existing) existing.push(item);
      else buckets.set(aisle, [item]);
    }
    for (const aisle of SHOPPING_AISLES) {
      const rows = buckets.get(aisle);
      if (!rows) continue;
      lines.push(aisle.toUpperCase());
      for (const it of rows) {
        const unit = it.isExtra ? (it.extraUnit ?? "g") : "g";
        const restock = it.isExtra ? " (restock)" : "";
        lines.push(`- ${it.name} — ${it.totalGrams} ${unit}${restock}`);
        const note = meta.get(nameKey(it.name))?.notes;
        if (note) lines.push(`    note: ${note}`);
      }
      lines.push("");
    }
    const text = lines.join("\n").trimEnd();
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Shopping list copied");
    } catch {
      toast.error(
        "Couldn't copy automatically — select the list and copy manually.",
      );
    }
  }

  const remaining = items.length - checked.size;

  // Resolve the open sheet's item from the live display set so it
  // reflects edits (e.g. a qty change) without a stale snapshot.
  const sheetItem = sheetItemName
    ? (displayItems.find((d) => d.name === sheetItemName) ?? null)
    : null;

  return (
    // Split on large screens: list takes the flexible column, nearby
    // stores become a fixed-width right sidebar. On mobile it's a single
    // column (block flow) so the list stays first.
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-4 lg:space-y-0">
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {/* Header: title block on the left (always), action buttons
            in a vertical column on the right. Stacking the two
            actions one above the other gives "Copy as text" and
            "Export PDF" equal weight without forcing the eye to
            scan horizontally between them; on mobile the column
            stretches full-width so neither button gets cramped. */}
        <header className="flex flex-col gap-3 border-b border-border/60 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              Shopping list
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Aggregated from the meal slots you&apos;ve filled across the
              selected range. Marks reset when you change the range.
            </p>
          </div>
          {items.length > 0 && (
            <div className="flex w-full flex-col gap-1.5 sm:w-36 sm:shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyAsText}
                /* `text-xs` overrides the Button base's `text-sm` so
                   the label here matches the Export PDF anchor below
                   (which is a styled <a>, not a Button). */
                className="h-9 w-full justify-center gap-1.5 text-xs sm:h-8"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy as text
              </Button>
              {/* Open the print-optimised report in a new tab so the
                  user's place in the live shopping list (range,
                  ticked items, drag work in progress) isn't lost.
                  The report inherits the current range via query
                  params and reads meta/pantry the same way the live
                  view does, so notes + aisle overrides print too. */}
              <a
                href={`/shopping-report?preset=${preset}&start=${start}&end=${end}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
              >
                <FileDown className="h-3.5 w-3.5" />
                Export PDF
              </a>
            </div>
          )}
        </header>

        <div className="flex flex-wrap gap-1.5 border-b border-border/60 bg-muted/20 px-3 py-2.5 sm:px-5">
          {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => {
            const active = preset === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                aria-pressed={active}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 ${
                  active
                    ? "border-foreground/40 bg-foreground text-background"
                    : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                }`}
              >
                {PRESET_LABELS[p]}
              </button>
            );
          })}
        </div>

        <div className="border-b border-border/60 bg-muted/10 px-3 py-2 text-[11px] tabular-nums text-muted-foreground sm:px-5">
          {dayLabel(start)} → {dayLabel(end)}{" "}
          {items.length > 0 && (
            <>
              · {items.length} item{items.length === 1 ? "" : "s"}
              {checked.size > 0 && ` · ${remaining} left`}
            </>
          )}
        </div>

        {logs === null ? (
          <p className="px-5 py-8 text-center text-xs text-muted-foreground">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 mx-3 my-3 px-4 py-10 text-center sm:mx-5 sm:my-5">
            <ShoppingCart className="mx-auto h-6 w-6 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium text-foreground">
              Nothing planned for this range
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Your shopping list builds itself from the foods you've logged. Add
              a meal to today or any day in the range, then come back.
            </p>
            {onGoToPlan && (
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  onClick={onGoToPlan}
                >
                  Open Meal Plan
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* Grouped by aisle so the list reads as a single store
             walk. Each section is a DnD drop target: dragging a row
             into a section persists the user's choice via
             shoppingListMeta, so re-categorizations stick across
             range changes and refreshes. */
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="divide-y divide-border/40">
              {groupedByAisle.map(({ aisle, rows }) => (
                <AisleSection
                  key={aisle}
                  aisle={aisle}
                  rows={rows}
                  checked={checked}
                  onToggleChecked={toggle}
                  meta={meta}
                  onSendToPantry={(it) => void sendToPantry(it)}
                  onRemoveFromList={(it) => void removeFromList(it)}
                  onOpenSheet={(name) => setSheetItemName(name)}
                />
              ))}
            </div>
            {/* Floating clone of the dragged row. Rendered in a
                portal so it sits above the list and follows the
                cursor freely across aisles. `dropAnimation={null}`
                kills the snap-back-to-source animation on cancel —
                we already optimistically updated the meta, so the
                row should appear in the new aisle on the next
                render rather than fly back. */}
            <DragOverlay dropAnimation={null}>
              {activeDragItem && (
                <div className="pointer-events-none flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-sm shadow-lg sm:px-5 sm:py-3">
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span className="truncate font-medium text-foreground">
                    {activeDragItem.name}
                  </span>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                    {activeDragItem.isExtra
                      ? `${activeDragItem.totalGrams} ${activeDragItem.extraUnit ?? "g"}`
                      : `${activeDragItem.totalGrams} g`}
                  </span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}

        {hiddenCount > 0 && items.length > 0 && (
          /* "Show hidden" affordance — appears only when the
             current range has at least one excluded computed item.
             Single tap restores all of them; the user keeps fine-
             grained control by tapping the X again on any row
             they'd rather not see. */
          <div className="flex items-center justify-between gap-2 border-t border-border/40 bg-muted/10 px-3 py-2 text-[11px] sm:px-5">
            <span className="text-muted-foreground">
              {hiddenCount} hidden item{hiddenCount === 1 ? "" : "s"} in this
              range
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => void unhideAll()}
            >
              Show
            </Button>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 sm:px-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              Prev
            </Button>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              Page {safePage + 1} of {totalPages} · {items.length} items
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        )}

        {checked.size > 0 && (
          <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 sm:px-5">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {checked.size} of {items.length} marked
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearChecks}
              className="h-7 text-xs text-muted-foreground"
            >
              Reset
            </Button>
          </div>
        )}
      </section>

      <div className="space-y-4 lg:sticky lg:top-4">
        <section className="rounded-lg border border-border/60 bg-card px-3 py-3 sm:px-5">
          <NearbyStores />
        </section>
        <section className="rounded-lg border border-border/60 bg-card px-3 py-3 empty:hidden sm:px-5">
          <FavoriteStores />
        </section>
      </div>

      <ShoppingItemSheet
        item={sheetItem}
        note={sheetItem ? meta.get(nameKey(sheetItem.name))?.notes : undefined}
        onOpenChange={(o) => {
          if (!o) setSheetItemName(null);
        }}
        onSaveQty={(it, grams, count) => void saveQty(it, grams, count)}
        onSendToPantry={(it) => void sendToPantry(it)}
        onSaveNote={(it, note) => void saveNote(it, note)}
        onRemove={(it) => void removeFromList(it)}
      />
    </div>
  );
}

type AisleSectionProps = {
  aisle: ShoppingAisle;
  rows: DisplayItem[];
  checked: Set<string>;
  onToggleChecked: (name: string) => void;
  meta: Map<string, ShoppingListMeta>;
  onSendToPantry: (item: DisplayItem) => void;
  onRemoveFromList: (item: DisplayItem) => void;
  onOpenSheet: (name: string) => void;
};

/** One aisle group. Wraps a Droppable (so a row dropped anywhere in
 *  the section moves into this aisle) around the section header
 *  and its list of rows. */
function AisleSection({
  aisle,
  rows,
  checked,
  onToggleChecked,
  meta,
  onSendToPantry,
  onRemoveFromList,
  onOpenSheet,
}: AisleSectionProps) {
  const Icon = AISLE_ICON[aisle];
  const color = AISLE_COLORS[aisle];
  const { setNodeRef, isOver } = useDroppable({
    id: `aisle:${aisle}`,
    data: { aisle },
  });
  return (
    <section
      ref={setNodeRef}
      className={`relative transition-colors ${
        isOver ? "bg-accent/40 ring-2 ring-inset ring-primary/50" : ""
      }`}
    >
      {/* Aisle header. Generous vertical padding (py-3 vs the old
          py-1.5) gives each section a clearer rest line; the
          per-aisle tinted background + matching icon and label
          colors read as "you're in Produce now" without needing a
          full-width banner. */}
      <div
        className={`flex items-center gap-2 px-3 py-3 sm:px-5 sm:py-3.5 ${color.bg}`}
      >
        <Icon
          className={`h-4 w-4 ${color.icon}`}
          aria-hidden
        />
        <h3
          className={`text-xs font-semibold uppercase tracking-wider ${color.text}`}
        >
          {aisle}
        </h3>
        <span
          className={`ml-auto font-mono text-[10px] tabular-nums opacity-70 ${color.text}`}
        >
          {rows.length}
        </span>
      </div>
      <ul className="divide-y divide-border/40">
        {rows.map((it) => (
          <ShoppingRow
            key={it.name}
            item={it}
            isChecked={checked.has(it.name)}
            onToggleChecked={onToggleChecked}
            note={meta.get(nameKey(it.name))?.notes}
            onSendToPantry={onSendToPantry}
            onRemoveFromList={onRemoveFromList}
            onOpenSheet={onOpenSheet}
          />
        ))}
      </ul>
    </section>
  );
}

type ShoppingRowProps = {
  item: DisplayItem;
  isChecked: boolean;
  onToggleChecked: (name: string) => void;
  note: string | undefined;
  onSendToPantry: (item: DisplayItem) => void;
  onRemoveFromList: (item: DisplayItem) => void;
  onOpenSheet: (name: string) => void;
};

/** Single row in the shopping list — a clean tap target matching the
 *  pantry / meal-log grids: grip (drag to aisle) + checkbox (mark
 *  bought) + name/quantity that opens the action sheet. All editing
 *  (quantity, note, send-to-pantry, remove) lives in the sheet, so the
 *  row stays calm instead of crowding inline inputs and an icon cluster.
 *  Swipe still works (left = remove with undo, right = to pantry). */
function ShoppingRow({
  item,
  isChecked,
  onToggleChecked,
  note,
  onSendToPantry,
  onRemoveFromList,
  onOpenSheet,
}: ShoppingRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item:${nameKey(item.name)}`,
    data: { name: item.name },
  });
  return (
    <li
      ref={setNodeRef}
      className={`transition-opacity ${
        // When dragging, fade the source row hard so the DragOverlay
        // clone is the obvious "this is the thing you're moving"
        // signal and the original doesn't visually compete.
        isDragging ? "opacity-20" : ""
      } ${isChecked ? "opacity-60" : ""}`}
    >
      <SwipeRow
        onSwipeLeft={() => onRemoveFromList(item)}
        onSwipeRight={() => onSendToPantry(item)}
        leftReveal={{
          label: "Remove",
          intent: "danger",
          icon: <X className="h-3.5 w-3.5" />,
        }}
        rightReveal={{
          label: "To pantry",
          intent: "info",
          icon: <PackagePlus className="h-3.5 w-3.5" />,
        }}
        surfaceClassName="bg-card px-3 py-2.5 sm:px-5 sm:py-3"
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            {...listeners}
            {...attributes}
            aria-label={`Drag ${item.name} to another aisle`}
            className="-ml-1 flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleChecked(item.name)}
            className="h-4 w-4 shrink-0 cursor-pointer accent-foreground"
            aria-label={`Mark ${item.name} as bought`}
          />
          {/* The whole name + quantity area is the tap target → opens
              the action sheet. */}
          <button
            type="button"
            onClick={() => onOpenSheet(item.name)}
            aria-label={`${item.name} — open actions`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 text-left transition-colors active:bg-muted/40"
          >
            <span className="min-w-0 flex-1">
              <span
                className={`flex items-center gap-2 ${
                  isChecked
                    ? "text-muted-foreground line-through"
                    : "font-medium text-foreground"
                }`}
              >
                <span className="truncate text-sm">{item.name}</span>
                {item.isExtra && (
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    Restock
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                {item.isExtra
                  ? `${item.totalGrams} ${item.extraUnit ?? "g"} · restock`
                  : `${item.totalGrams} g · ${item.appearances}×`}
                {note ? ` · ${note}` : ""}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          </button>
        </div>
      </SwipeRow>
    </li>
  );
}
