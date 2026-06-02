"use client";

import type { ResolvedPantryScan } from "@/app/api/identify-pantry/route";
import { SwipeRow } from "@/components/gestures/SwipeRow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonRow } from "@/components/ui/skeleton";
import {
  addPantryItem,
  deletePantryItem,
  deleteShoppingListMeta,
  listPantryItems,
  upsertPantryItem,
  upsertShoppingListMeta,
  type PantryItem,
} from "@/lib/db";
import { isLow, isVolumeUnit } from "@/lib/pantry/consume";
import { PANTRY_UNIT_PRESETS, isPresetUnit } from "@/lib/pantry/units";
import {
  AISLE_COLORS,
  SHOPPING_AISLES,
  type ShoppingAisle,
  categorizeFallback,
  tallyAisles,
} from "@/lib/shopping/categorize";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  ListPlus,
  Package,
  Pencil,
  Plus,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  PantryScanReviewDialog,
  type PantryDraftItem,
} from "./PantryScanReviewDialog";
import { PantryScanSheet } from "./PantryScanSheet";
import { SheetAction } from "./SheetAction";
import { ShopForMeDialog } from "./ShopForMeDialog";

/** Mass / volume units the pantry knows by name (the rest go
 *  through `isVolumeUnit` for the cup/tbsp/tsp family). Used to
 *  pick a sensible default quantity when sending an item to the
 *  shopping list — mass + volume things get 100 (g/ml/etc), count
 *  things get 1. */
const MASS_VOLUME_UNITS = new Set(["g", "kg", "mg", "ml", "l"]);

/** Settings → Pantry: a simple inventory list of what the user has on
 *  hand. Name + quantity + free-text unit per item. Items are grouped
 *  into store aisles (auto-derived from the name) with a category
 *  filter, and the list is paged. No per-item macros (these are
 *  groceries, not logged foods).
 *
 *  Storage is the synced `pantryItems` IDB store (see lib/db.ts); the
 *  list re-reads on every realtime arrival via `useDataRev`. Mutations
 *  call `bumpPending()` so the sync pill reflects the unsynced edit,
 *  matching MyFoodsView / RecipesView.
 *
 *  Photo-scan-to-fill is a planned fast-follow (a `/api/identify-pantry`
 *  route + the existing CameraSheet pipeline); this view ships the
 *  durable manual core first. */
export function PantryView({ aiAvailable = false }: { aiAvailable?: boolean }) {
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PantryItem | null>(null);
  // `null` = not adding; a draft object = the inline add row is open.
  const [draft, setDraft] = useState<DraftFields | null>(null);
  // id of the row being edited inline, or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<DraftFields>(EMPTY_DRAFT);
  // Which item's action sheet is open (mobile tap-to-act). The sheet
  // hosts the per-item actions and the multi-field editor, replacing the
  // old cramped icon cluster + inline edit row.
  const [sheetItemId, setSheetItemId] = useState<string | null>(null);
  // Photo-scan sheet + its review dialog. `scanResult` non-null opens
  // the review dialog; the sheet closes itself once it has a result.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanResult, setScanResult] = useState<ResolvedPantryScan | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  // Set when the user taps "Restock" on a row, so the Shop-for-me dialog
  // pre-seeds (and selects) that specific item even if it's not yet a gap.
  const [restockItemId, setRestockItemId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<ShoppingAisle | "all">(
    "all",
  );
  const [page, setPage] = useState(0);
  const pantryRev = useDataRev("pantryItems");

  useEffect(() => {
    let cancelled = false;
    listPantryItems()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setItems([]);
        toast.error("Couldn't load your pantry. Try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, [pantryRev]);

  async function refresh() {
    try {
      setItems(await listPantryItems());
    } catch (err) {
      reportStorageError(err);
      setItems([]);
    }
  }

  // Search narrows first; the category chips (with counts) and the
  // visible list both work off that result.
  const searchFiltered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, query]);

  const counts = useMemo(
    () => tallyAisles((searchFiltered ?? []).map(effectiveCategory)),
    [searchFiltered],
  );

  // Aisles that actually have items, in store-walk order — the chips.
  const activeAisles = useMemo(
    () => SHOPPING_AISLES.filter((a) => counts[a] > 0),
    [counts],
  );

  const filtered = useMemo(() => {
    if (!searchFiltered) return null;
    if (filterCategory === "all") return searchFiltered;
    return searchFiltered.filter(
      (i) => effectiveCategory(i) === filterCategory,
    );
  }, [searchFiltered, filterCategory]);

  // Pagination, mirroring MyFoodsView: reset to page 0 whenever the
  // search/category narrows (during-render pattern, not an effect — keeps
  // clear of react-hooks/set-state-in-effect).
  const filterSignature = `${query}|${filterCategory}`;
  const [prevFilterSignature, setPrevFilterSignature] =
    useState(filterSignature);
  if (prevFilterSignature !== filterSignature) {
    setPrevFilterSignature(filterSignature);
    setPage(0);
  }
  const totalPages = filtered
    ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    : 1;
  const safePage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () =>
      filtered
        ? filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
        : null,
    [filtered, safePage],
  );

  async function handleAdd(fields: DraftFields) {
    const parsed = parseFields(fields);
    if (!parsed) return;
    try {
      await addPantryItem(parsed);
      bumpPending();
      setDraft(null);
      // The db helper buses `pantryItems`, so `useDataRev` re-fires and
      // the items list re-reads on its own — no explicit refresh needed.
      toast.success(`Added ${parsed.name} to your pantry`);
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't save that item");
    }
  }

  /** Commit reviewed scan rows. One write path with the rest of the
   *  view (addPantryItem → bumpPending → refresh). Per-item failures
   *  are counted so a single bad row doesn't sink the batch. */
  async function handleScanConfirm(drafts: PantryDraftItem[]) {
    setScanResult(null);
    if (drafts.length === 0) return;
    let added = 0;
    for (const d of drafts) {
      try {
        await addPantryItem({
          name: d.name,
          quantity: d.quantity,
          unit: d.unit,
        });
        added++;
      } catch (err) {
        reportStorageError(err);
      }
    }
    if (added > 0) {
      bumpPending();
      toast.success(
        `Added ${added} ${added === 1 ? "item" : "items"} from scan`,
      );
    } else {
      toast.error("Couldn't save the scanned items");
    }
  }

  async function handleSaveEdit(item: PantryItem, fields: DraftFields) {
    const parsed = parseFields(fields);
    if (!parsed) return;
    try {
      await upsertPantryItem({ ...item, ...parsed });
      bumpPending();
      setEditingId(null);
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't update that item");
    }
  }

  async function handleDelete(item: PantryItem) {
    // Optimistic remove so the row vanishes immediately; reconcile from
    // IDB on failure.
    setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    setPendingDelete(null);
    try {
      await deletePantryItem(item.id);
      // Cascade: drop any shoppingListMeta override the user set on
      // this item via "Send to shopping list". Otherwise the meta
      // entry orphans against the lowercased name and lingers as
      // an unreachable row in IDB. Best-effort — a meta-write
      // failure shouldn't block the pantry delete.
      try {
        await deleteShoppingListMeta(item.name);
      } catch {
        // swallow — the pantry delete is the user's intent.
      }
      bumpPending();
    } catch (err) {
      reportStorageError(err);
      await refresh();
    }
  }

  /** "Add this pantry item to my shopping list." Writes a manual
   *  extra into the shoppingListMeta store with a sensible default
   *  quantity (twice the low-stock threshold when set, otherwise a
   *  pragmatic 100-for-mass / 1-for-count). Also carries the
   *  pantry's aisle through so the item lands in the right group
   *  on the shopping list without an extra drag. */
  async function sendToShoppingList(item: PantryItem) {
    const isMeasured =
      MASS_VOLUME_UNITS.has(item.unit.toLowerCase()) || isVolumeUnit(item.unit);
    const extraQty =
      item.lowThreshold && item.lowThreshold > 0
        ? Math.max(item.lowThreshold * 2, 1)
        : isMeasured
          ? 100
          : 1;
    try {
      await upsertShoppingListMeta(item.name, {
        extraQty,
        extraUnit: item.unit,
        category: item.category,
      });
      toast.success(`${item.name} added to shopping list`);
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't add to shopping list. Try again.");
    }
  }

  const loading = items === null;
  const empty = !loading && (filtered?.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Pantry</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What you have on hand — name, quantity, and unit. Synced across
              your signed-in devices.
            </p>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => setShopOpen(true)}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              Shop for me
            </Button>
            {aiAvailable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => setScanOpen(true)}
              >
                <ScanLine className="h-3.5 w-3.5" />
                Scan
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setEditingId(null);
              }}
              disabled={draft !== null}
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </Button>
          </div>
        </header>

        {/* Search — only worth showing once there's a handful of items. */}
        {!loading && (items?.length ?? 0) > 0 && (
          <div className="space-y-2 border-b border-border/60 px-5 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your pantry…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            {/* Category filter chips — derived from item names, only the
                aisles that actually have items. Hidden when everything is
                one category (nothing to filter). */}
            {activeAisles.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <CategoryChip
                  label="All"
                  count={(searchFiltered ?? []).length}
                  active={filterCategory === "all"}
                  onClick={() => setFilterCategory("all")}
                />
                {activeAisles.map((aisle) => (
                  <CategoryChip
                    key={aisle}
                    label={aisle}
                    count={counts[aisle]}
                    active={filterCategory === aisle}
                    onClick={() => setFilterCategory(aisle)}
                    aisle={aisle}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Inline add row. */}
        {draft && (
          <PantryItemEditor
            fields={draft}
            onChange={setDraft}
            onSave={() => handleAdd(draft)}
            onCancel={() => setDraft(null)}
            saveLabel="Add"
          />
        )}

        {loading ? (
          <div className="space-y-2 px-5 py-4">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : empty ? (
          <div className="px-5 py-10 text-center">
            <Package className="mx-auto h-5 w-5 text-muted-foreground/60" />
            <p className="mt-2 text-xs text-muted-foreground">
              {items && items.length === 0
                ? "Your pantry is empty. Add what you have on hand."
                : "No items match your search."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {(paged ?? []).map((item) => (
              <li key={item.id}>
                <SwipeRow
                  onSwipeLeft={() => setPendingDelete(item)}
                  onSwipeRight={() => void sendToShoppingList(item)}
                  leftReveal={{
                    label: "Delete",
                    intent: "danger",
                    icon: <Trash2 className="h-3.5 w-3.5" />,
                  }}
                  rightReveal={{
                    label: "To shopping list",
                    intent: "info",
                    icon: <ListPlus className="h-3.5 w-3.5" />,
                  }}
                  surfaceClassName="bg-card"
                >
                  {/* The whole row is a single tap target → opens the
                      action sheet. `truncate` lives on the block-level
                      <p> with a `min-w-0 flex-1` parent so long names clip
                      instead of overrunning the quantity. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`${item.name} — open actions`}
                    onClick={() => setSheetItemId(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSheetItemId(item.id);
                      }
                    }}
                    className="flex cursor-pointer items-center gap-2 px-5 py-3 text-left transition-colors active:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {(() => {
                          const aisle = effectiveCategory(item);
                          const color = AISLE_COLORS[aisle];
                          return (
                            <Badge
                              variant="secondary"
                              className={`text-[10px] font-medium uppercase tracking-wide ${color.bg} ${color.text} hover:${color.bg}`}
                            >
                              {aisle}
                            </Badge>
                          );
                        })()}
                        {isLow(item) && (
                          <Badge
                            variant="secondary"
                            className="bg-amber-500/15 text-[10px] font-medium uppercase tracking-wide text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
                          >
                            Low
                          </Badge>
                        )}
                      </div>
                    </div>
                    <span className="max-w-[40%] shrink-0 truncate font-mono text-xs tabular-nums text-muted-foreground">
                      {item.quantity} {item.unit}
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                  </div>
                </SwipeRow>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination footer — hidden when everything fits on one page. */}
        {!loading && !empty && totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-2.5">
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
            <span className="text-xs text-muted-foreground">
              Page {safePage + 1} of {totalPages} · {filtered?.length ?? 0}{" "}
              items
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
      </section>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from pantry?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will be removed from your pantry on all your devices.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && handleDelete(pendingDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {aiAvailable && (
        <>
          <PantryScanSheet
            open={scanOpen}
            onOpenChange={setScanOpen}
            onScanResolved={(result) => setScanResult(result)}
          />
          <PantryScanReviewDialog
            open={scanResult !== null}
            onOpenChange={(o) => {
              if (!o) setScanResult(null);
            }}
            result={scanResult}
            onConfirm={handleScanConfirm}
          />
        </>
      )}

      <ShopForMeDialog
        open={shopOpen}
        onOpenChange={(o) => {
          setShopOpen(o);
          if (!o) setRestockItemId(null);
        }}
        pantryItems={items ?? []}
        extraSeedItemId={restockItemId ?? undefined}
      />

      {/* Tap-to-act sheet: per-item actions + the multi-field editor,
          replacing the old per-row icon cluster and inline edit row. */}
      <Dialog
        open={sheetItemId !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (editingId === sheetItemId) setEditingId(null);
            setSheetItemId(null);
          }
        }}
      >
        <DialogContent className="gap-3">
          {(() => {
            const item = (items ?? []).find((i) => i.id === sheetItemId);
            if (!item) return null;
            const editing = editingId === item.id;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="truncate pr-6 text-left">
                    {item.name}
                  </DialogTitle>
                  <DialogDescription className="text-left font-mono text-xs tabular-nums">
                    {item.quantity} {item.unit}
                  </DialogDescription>
                </DialogHeader>
                {editing ? (
                  <PantryItemEditor
                    fields={editFields}
                    onChange={setEditFields}
                    onSave={() => {
                      void handleSaveEdit(item, editFields);
                      setSheetItemId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                    saveLabel="Save"
                  />
                ) : (
                  <div className="space-y-0.5 pt-1">
                    <SheetAction
                      icon={Pencil}
                      label="Edit item"
                      hasNext
                      onClick={() => {
                        setEditFields({
                          name: item.name,
                          quantity: String(item.quantity),
                          unit: item.unit,
                          category: item.category ?? "",
                          density:
                            item.density != null ? String(item.density) : "",
                          lowThreshold:
                            item.lowThreshold != null
                              ? String(item.lowThreshold)
                              : "",
                        });
                        setDraft(null);
                        setEditingId(item.id);
                      }}
                    />
                    <SheetAction
                      icon={ListPlus}
                      label="Send to shopping list"
                      onClick={() => {
                        void sendToShoppingList(item);
                        setSheetItemId(null);
                      }}
                    />
                    <SheetAction
                      icon={ShoppingCart}
                      label="Restock with AI"
                      onClick={() => {
                        setRestockItemId(item.id);
                        setShopOpen(true);
                        setSheetItemId(null);
                      }}
                    />
                    <SheetAction
                      icon={Trash2}
                      label="Remove"
                      destructive
                      onClick={() => {
                        setPendingDelete(item);
                        setSheetItemId(null);
                      }}
                    />
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A pill in the pantry's category filter row. When `aisle` is set,
 *  the chip picks up the shared aisle palette so the same Produce
 *  green reads "Produce" here, on each pantry row's badge, and on
 *  the shopping list section header. The "All" chip (no aisle)
 *  falls back to the neutral primary style. */
function CategoryChip({
  label,
  count,
  active,
  onClick,
  aisle,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  aisle?: ShoppingAisle;
}) {
  const color = aisle ? AISLE_COLORS[aisle] : null;
  const className = active
    ? color
      ? `${color.bg} ${color.text} ${color.border}`
      : "border-primary bg-primary text-primary-foreground"
    : color
      ? `border-border/60 ${color.text} opacity-70 hover:opacity-100 hover:bg-accent`
      : "border-border/60 text-muted-foreground hover:bg-accent";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${className}`}
    >
      {label}
      <span className={active ? "opacity-80" : "opacity-60"}>{count}</span>
    </button>
  );
}

type DraftFields = {
  name: string;
  quantity: string;
  unit: string;
  /** Aisle override; "" means "auto-derive from the name". */
  category: string;
  /** Density in g/ml for volume units; "" means the ~1 default. */
  density: string;
  /** Per-item "low when ≤" override; "" means the global default rule. */
  lowThreshold: string;
};

const EMPTY_DRAFT: DraftFields = {
  name: "",
  quantity: "1",
  unit: "",
  category: "",
  density: "",
  lowThreshold: "",
};

/** Sentinel `Select` value for the "Custom…" option — distinct from any
 *  real unit so picking it switches the editor to free-text entry. */
const CUSTOM_UNIT = "__custom__";

/** Sentinel `Select` value for "Auto" — no category override, derive the
 *  aisle from the item name. */
const AUTO_CATEGORY = "__auto__";

/** The aisle shown for an item: the user's override if set, otherwise the
 *  guess from its name. */
function effectiveCategory(item: PantryItem): ShoppingAisle {
  return item.category ?? categorizeFallback(item.name);
}

/** Rows per page in the pantry list. Matches MyFoodsView. */
const PAGE_SIZE = 20;

/** Validate + normalize the three free-text inputs into a savable
 *  shape. Returns null (and toasts) when name is blank or quantity
 *  isn't a non-negative number — the inline editor stays open so the
 *  user can fix it. Unit is optional-ish: blank coalesces to a single
 *  generic "x" marker so the row still renders sensibly. */
function parseFields(
  fields: DraftFields,
): {
  name: string;
  quantity: number;
  unit: string;
  category?: ShoppingAisle;
  density?: number;
  lowThreshold?: number;
} | null {
  const name = fields.name.trim();
  if (!name) {
    toast.error("Give the item a name");
    return null;
  }
  const quantity = Number(fields.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) {
    toast.error("Quantity must be a non-negative number");
    return null;
  }
  const unit = fields.unit.trim() || "x";
  const category = (SHOPPING_AISLES as readonly string[]).includes(
    fields.category,
  )
    ? (fields.category as ShoppingAisle)
    : undefined;
  // Density only applies to volume units; a positive number or unset.
  const parsedDensity = Number(fields.density);
  const density =
    isVolumeUnit(unit) && Number.isFinite(parsedDensity) && parsedDensity > 0
      ? parsedDensity
      : undefined;
  // Low threshold: a non-negative number when the user filled it in,
  // otherwise unset (fall back to the global rule).
  const parsedLow =
    fields.lowThreshold.trim() === ""
      ? Number.NaN
      : Number(fields.lowThreshold);
  const lowThreshold =
    Number.isFinite(parsedLow) && parsedLow >= 0 ? parsedLow : undefined;
  return {
    name: name.slice(0, 200),
    quantity,
    unit: unit.slice(0, 40),
    category,
    density,
    lowThreshold,
  };
}

/** Inline add/edit row: name + quantity + unit + save/cancel. Shared by
 *  the "Add item" affordance and per-row editing so the field layout
 *  stays identical. Enter saves, Escape cancels. */
function PantryItemEditor({
  fields,
  onChange,
  onSave,
  onCancel,
  saveLabel,
}: {
  fields: DraftFields;
  onChange: (next: DraftFields) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  // Drop into the free-text input when the current unit isn't one of the
  // curated presets — covers legacy items typed as "breasts" / "cans"
  // so editing never silently loses their unit.
  const [customUnit, setCustomUnit] = useState(
    () => fields.unit.trim() !== "" && !isPresetUnit(fields.unit),
  );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-5 py-2.5">
      <Input
        value={fields.name}
        onChange={(e) => onChange({ ...fields, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Item (e.g. Eggs)"
        autoFocus
        className="h-8 min-w-0 flex-1 basis-40 text-sm"
        aria-label="Item name"
      />
      <Input
        value={fields.quantity}
        onChange={(e) =>
          onChange({
            ...fields,
            quantity: e.target.value.replace(/[^\d.]/g, ""),
          })
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
        inputMode="decimal"
        placeholder="Qty"
        className="h-8 w-16 text-center text-sm"
        aria-label="Quantity"
      />
      <Select
        value={customUnit ? CUSTOM_UNIT : fields.unit || undefined}
        onValueChange={(v) => {
          if (v === CUSTOM_UNIT) {
            setCustomUnit(true);
          } else {
            setCustomUnit(false);
            onChange({ ...fields, unit: v });
          }
        }}
      >
        <SelectTrigger
          className="h-8 w-28 text-sm"
          aria-label="Unit"
        >
          <SelectValue placeholder="Unit" />
        </SelectTrigger>
        <SelectContent>
          {PANTRY_UNIT_PRESETS.map((p) => (
            <SelectItem
              key={p.value}
              value={p.value}
            >
              {p.label}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_UNIT}>Custom…</SelectItem>
        </SelectContent>
      </Select>
      {customUnit && (
        <Input
          value={fields.unit}
          onChange={(e) => onChange({ ...fields, unit: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Custom unit"
          className="h-8 w-24 text-sm"
          aria-label="Custom unit"
          autoFocus
        />
      )}
      {/* Aisle override. "Auto" (the default) derives the aisle from the
          name; pick an aisle to correct a wrong guess. */}
      <Select
        value={fields.category || AUTO_CATEGORY}
        onValueChange={(v) =>
          onChange({ ...fields, category: v === AUTO_CATEGORY ? "" : v })
        }
      >
        <SelectTrigger
          className="h-8 w-32 text-sm"
          aria-label="Category"
        >
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_CATEGORY}>Auto</SelectItem>
          {SHOPPING_AISLES.map((aisle) => (
            <SelectItem
              key={aisle}
              value={aisle}
            >
              {aisle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Density (g/ml) — only for volume units, where it converts a
          recipe's grams into the right volume draw-down. */}
      {isVolumeUnit(fields.unit) && (
        <Input
          value={fields.density}
          onChange={(e) =>
            onChange({
              ...fields,
              density: e.target.value.replace(/[^\d.]/g, ""),
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
          inputMode="decimal"
          placeholder="g/ml (1)"
          className="h-8 w-20 text-center text-sm"
          aria-label="Density in grams per millilitre"
        />
      )}
      {/* Per-item low-stock override ("warn when ≤ this many"). Blank =
          fall back to the global rule. */}
      <Input
        value={fields.lowThreshold}
        onChange={(e) =>
          onChange({
            ...fields,
            lowThreshold: e.target.value.replace(/[^\d.]/g, ""),
          })
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
        inputMode="decimal"
        placeholder="Low ≤"
        className="h-8 w-20 text-center text-sm"
        aria-label="Low-stock threshold"
      />
      <Button
        type="button"
        size="icon"
        className="h-8 w-8"
        onClick={onSave}
        aria-label={saveLabel}
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        onClick={onCancel}
        aria-label="Cancel"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
