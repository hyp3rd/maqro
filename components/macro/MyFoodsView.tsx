"use client";

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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
  addCustomFood,
  computeSortBetween,
  deleteCustomFood,
  listCustomFoods,
  setSortOrder,
  type CustomFood,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  GripVertical,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CameraSheet } from "./CameraSheet";
import { CustomFoodForm } from "./CustomFoodForm";
import { FoodViewDialog } from "./FoodViewDialog";
import { OffSavePreviewDialog } from "./OffSavePreviewDialog";
import { OffSearchDialog } from "./OffSearchDialog";
import { SortControl, sortByMode, useSortMode } from "./SortControl";
import type { Food, FoodKind } from "./types";
import { useSortableRow } from "./useSortableRow";

/** Page size for the My Foods list. 20 keeps the table within a
 *  single mobile viewport scroll while leaving headroom for the
 *  filter chips and pagination controls above and below. */
const PAGE_SIZE = 20;

/** Closed-set filter values for the diet-kind chips. `"all"` and
 *  `"unclassified"` are sibling states alongside the six `FoodKind`
 *  values, kept as a separate union so the filter UI can reason
 *  about the no-filter and untagged cases the same way. */
type KindFilter = FoodKind | "all" | "unclassified";

const KIND_FILTER_LABELS: Record<KindFilter, string> = {
  all: "All",
  "land-meat": "Land meat",
  seafood: "Seafood",
  egg: "Egg",
  dairy: "Dairy",
  honey: "Honey",
  plant: "Plant",
  unclassified: "Unclassified",
};

/** Order chips render in. Mirrors the order users see in the diet-
 *  kind picker on the edit form; "All" sits at the front so the
 *  no-filter state is the first thumb-reachable target on mobile. */
const KIND_FILTER_ORDER: readonly KindFilter[] = [
  "all",
  "land-meat",
  "seafood",
  "egg",
  "dairy",
  "honey",
  "plant",
  "unclassified",
];

/** Browse + manage everything saved under "My foods" — the same store
 * that powers the meal-plan search. Classify, edit, and prune custom
 * foods from one place. Bumps the search revision via onChange so the
 * meal-plan view re-queries after edits. */
export function MyFoodsView({ onChange }: { onChange?: () => void }) {
  const [foods, setFoods] = useState<CustomFood[] | null>(null);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFood | undefined>(undefined);
  const [viewing, setViewing] = useState<CustomFood | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomFood | null>(null);
  // OFF search dialog: a separate input/results surface for adding a
  // food. On pick, the chosen Food is handed to `offPreviewing` which
  // opens the preview-and-save dialog. Keeping them as two state vars
  // (rather than nesting dialogs) avoids Radix's nested-portal
  // surprises and lets the search close cleanly when the user
  // commits.
  const [offSearchOpen, setOffSearchOpen] = useState(false);
  const [offPreviewing, setOffPreviewing] = useState<Food | null>(null);
  // Camera (barcode-only): mounted with `aiAvailable={false}` so the
  // photo-identify tab is suppressed — the My Foods context only
  // accepts precise barcode-resolved entries to keep the saved data
  // trustworthy. On a successful scan, the resolved OFF Food flows
  // through `offPreviewing` so the user sees the same breakdown
  // preview as the OFF-search path.
  const [cameraOpen, setCameraOpen] = useState(false);
  // Diet-kind chip filter. `"all"` shows everything; a specific kind
  // narrows to that classification; `"unclassified"` surfaces the
  // foods that still need a kind picked (same warning the banner
  // calls out, exposed here as a one-click jump).
  const [filterKind, setFilterKind] = useState<KindFilter>("all");
  // Current page (zero-indexed) into the filtered list. Reset to 0
  // whenever the underlying filters change so the user isn't
  // stranded on an empty page after narrowing the result set.
  const [page, setPage] = useState(0);

  async function refresh() {
    try {
      const rows = await listCustomFoods();
      setFoods(rows);
    } catch (err) {
      reportStorageError(err);
      setFoods([]);
    }
  }

  // Bumps when a peer device's custom-food change arrives via realtime.
  // Including it in the effect's dep array re-runs the load.
  const customFoodsRev = useDataRev("customFoods");

  // Initial load + reload on realtime arrival. The state update happens
  // in the .then callback (after a microtask), so the
  // react-hooks/set-state-in-effect rule is satisfied — we're not
  // invoking setState synchronously inside the effect body.
  useEffect(() => {
    listCustomFoods()
      .then((rows) => setFoods(rows))
      .catch((err) => {
        reportStorageError(err);
        setFoods([]);
        toast.error("Couldn't load your foods. Try refreshing.");
      });
  }, [customFoodsRev]);

  const [sortMode, setSortMode] = useSortMode("sort:foods", "recent");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /** Counts per diet-kind across the unfiltered foods list. Surfaces
   *  in each chip label as "Plant (12)" so the user can spot a
   *  populated category at a glance without flipping through filters.
   *  Computed off `foods` (not `filtered`) so the chip numbers stay
   *  stable when the user types in the search box. */
  const kindCounts = useMemo<Record<KindFilter, number> | null>(() => {
    if (!foods) return null;
    const counts: Record<KindFilter, number> = {
      all: foods.length,
      "land-meat": 0,
      seafood: 0,
      egg: 0,
      dairy: 0,
      honey: 0,
      plant: 0,
      unclassified: 0,
    };
    for (const f of foods) {
      if (f.dietKind) counts[f.dietKind] += 1;
      else counts.unclassified += 1;
    }
    return counts;
  }, [foods]);

  const filtered = useMemo(() => {
    if (!foods) return null;
    const q = query.trim().toLowerCase();
    let matched = q
      ? foods.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.brand?.toLowerCase().includes(q),
        )
      : foods;
    if (filterKind === "unclassified") {
      matched = matched.filter((f) => !f.dietKind);
    } else if (filterKind !== "all") {
      matched = matched.filter((f) => f.dietKind === filterKind);
    }
    return sortByMode(matched, sortMode, {
      sortOrder: (f) => f.sortOrder,
      // "Type" on foods = dietKind (land-meat, seafood, plant, …).
      typeKey: (f) => f.dietKind,
    });
  }, [foods, query, filterKind, sortMode]);

  // Pagination: derive a safe page index that clamps when the
  // filtered list shrinks below the current page (e.g. user filters
  // down and the previously-viewed page no longer exists). Reset to
  // page 0 on any filter change so the user starts at the top of the
  // new result set.
  //
  // The reset is done via the "reset state during render" pattern
  // (React docs: "You might not need an Effect → Adjusting some
  // state when a prop changes") instead of a useEffect, which would
  // trip the react-hooks/set-state-in-effect rule. The trick: track
  // the previous filter signature in state and reset `page` to 0
  // when the signature changes — React schedules a re-render and
  // applies the corrected state before the user sees anything.
  const filterSignature = `${query}|${filterKind}|${sortMode}`;
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
  const paged = useMemo(() => {
    if (!filtered) return null;
    return filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  }, [filtered, safePage]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !filtered) return;
    const items = filtered;
    const without = items.filter((f) => f.id !== active.id);
    const insertAt = items.findIndex((f) => f.id === over.id);
    const before = without[insertAt - 1];
    const after = without[insertAt];
    const newOrder = computeSortBetween(
      before?.sortOrder ?? null,
      after?.sortOrder ?? null,
    );
    setFoods((prev) =>
      prev
        ? prev.map((f) =>
            f.id === active.id ? { ...f, sortOrder: newOrder } : f,
          )
        : prev,
    );
    try {
      await setSortOrder("customFoods", String(active.id), newOrder);
      bumpPending();
    } catch (err) {
      reportStorageError(err);
    }
  }

  const untaggedCount = useMemo(
    () => (foods ? foods.filter((f) => !f.dietKind).length : 0),
    [foods],
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    try {
      await deleteCustomFood(id);
      bumpPending();
      onChange?.();
      await refresh();
    } catch (err) {
      reportStorageError(err);
    }
  }

  /** Persist an OFF result (possibly enriched with the full breakdown
   *  via the preview dialog's barcode lookup) to My Foods. Routes
   *  every optional breakdown field through so a high-quality OFF row
   *  doesn't lose its sugars / fiber / fat-subtype data on save. */
  async function handleConfirmOffSave(food: Food) {
    if (food.source !== "off") return;
    try {
      await addCustomFood({
        name: food.name,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        calories: food.calories,
        brand: food.brand,
        sugars: food.sugars,
        addedSugars: food.addedSugars,
        fiber: food.fiber,
        saturatedFat: food.saturatedFat,
        transFat: food.transFat,
        monoFat: food.monoFat,
        polyFat: food.polyFat,
      });
      bumpPending();
      onChange?.();
      await refresh();
      toast.success(`Saved ${food.name} to My Foods`);
    } catch (err) {
      reportStorageError(err);
      toast.error(`Couldn't save ${food.name}`);
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">My Foods</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Custom foods you&apos;ve saved, plus anything imported from Open
              Food Facts. Classify them so the meal-plan diet filter respects
              your preferences.
            </p>
          </div>
          {/* Three entry methods for a custom food, surfaced as a
              dropdown so the row stays compact on mobile:
                - Manual entry — the existing CustomFoodForm
                - Search Open Food Facts — packaged-food lookup
                - Scan barcode — camera, barcode-only (no AI photo
                  identification, to avoid mixing estimated macros into
                  the user's trusted catalog) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 self-end sm:self-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                Add food
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
            >
              <DropdownMenuItem
                onClick={() => {
                  setEditing(undefined);
                  setFormOpen(true);
                }}
                className="gap-2"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                Manual entry
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setOffSearchOpen(true)}
                className="gap-2"
              >
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                Search Open Food Facts
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setCameraOpen(true)}
                className="gap-2"
              >
                <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
                Scan barcode
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="flex flex-col gap-2 border-b border-border/60 px-5 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or brand"
              className="h-9 pl-9"
            />
          </div>
          <SortControl
            modes={["recent", "name", "type", "custom"]}
            active={sortMode}
            onChange={setSortMode}
          />
        </div>

        {untaggedCount > 0 && (
          <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              <span className="font-medium">
                {untaggedCount} food{untaggedCount === 1 ? "" : "s"}{" "}
                unclassified.
              </span>{" "}
              Untagged foods only show up under the Omnivore diet preference —
              tap Edit and pick a kind to make them available to other diets.
            </p>
          </div>
        )}

        {/* Diet-kind filter chips. Each chip shows its count from the
            unfiltered foods list so the numbers stay stable when the
            user types in the search box. We hide empty chips entirely
            — chips for empty categories are noise and steal touch
            real estate on mobile. "All" is always present. */}
        {foods && foods.length > 0 && kindCounts && (
          <div className="flex flex-wrap gap-1.5 border-b border-border/60 bg-muted/20 px-5 py-2.5">
            {KIND_FILTER_ORDER.filter(
              (k) => k === "all" || kindCounts[k] > 0,
            ).map((k) => {
              const active = filterKind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilterKind(k)}
                  aria-pressed={active}
                  className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 ${
                    active
                      ? "border-foreground/40 bg-foreground text-background"
                      : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  }`}
                >
                  {KIND_FILTER_LABELS[k]}
                  <span
                    className={`tabular-nums ${active ? "opacity-80" : "opacity-60"}`}
                  >
                    ({kindCounts[k]})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!filtered || !paged ? (
          // Six placeholder rows roughly matching the actual card
          // layout so the page settles into its final geometry
          // without a reflow shock when data arrives.
          <div
            className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 mx-3 my-3 px-4 py-10 text-center sm:mx-5 sm:my-5">
            {foods && foods.length === 0 ? (
              <>
                <Plus className="mx-auto h-6 w-6 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  No custom foods yet
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  Save foods you use often so they're a tap away in the planner.
                  Add one manually, save an Open Food Facts result from the Meal
                  Plan search, or scan a barcode.
                </p>
                <div className="mt-4 flex justify-center">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditing(undefined);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add manually
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {filterKind !== "all"
                  ? `No foods in this category${query ? " match your search" : ""}.`
                  : "No matches for that filter."}
              </p>
            )}
          </div>
        ) : (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => void handleDragEnd(e)}
            >
              {/* Sortable context registers only the current page's
                  ids. Dragging within a page works as before; drag
                  across pages isn't supported (you'd need to switch
                  pages with a row in flight, which dnd-kit can't do
                  without infrastructure we don't have). For the realistic
                  use case — reorder a handful of foods you can see —
                  this is fine. */}
              <SortableContext
                items={paged.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                {/* Mobile: card list. The 7-column table is unreadable
                    below ~640px even with horizontal scroll — too much
                    squinting + sideways panning. Cards put the food name
                    front and centre with macros in a compact inline row. */}
                <ul className="divide-y divide-border/60 sm:hidden">
                  {paged.map((food) => (
                    <FoodMobileCard
                      key={food.id}
                      food={food}
                      draggable={sortMode === "custom"}
                      onView={() => setViewing(food)}
                      onEdit={() => {
                        setEditing(food);
                        setFormOpen(true);
                      }}
                      onDelete={() => setPendingDelete(food)}
                    />
                  ))}
                </ul>

                {/* Desktop: keep the dense table for at-a-glance comparison. */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {sortMode === "custom" && (
                          <th
                            className="w-8 px-1 py-2"
                            aria-hidden
                          />
                        )}
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Kind</th>
                        <th className="px-3 py-2 text-center">P</th>
                        <th className="px-3 py-2 text-center">C</th>
                        <th className="px-3 py-2 text-center">F</th>
                        <th className="px-3 py-2 text-center">kcal</th>
                        <th
                          className="w-24 px-3 py-2 text-right"
                          aria-hidden
                        />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {paged.map((food) => (
                        <FoodTableRow
                          key={food.id}
                          food={food}
                          draggable={sortMode === "custom"}
                          onView={() => setViewing(food)}
                          onEdit={() => {
                            setEditing(food);
                            setFormOpen(true);
                          }}
                          onDelete={() => setPendingDelete(food)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </SortableContext>
            </DndContext>

            {/* Pagination footer. Hidden when everything fits on one
                page so it doesn't clutter the small-list case. The
                indicator is intentionally bare ("Page 2 of 5") rather
                than a numbered selector — at 20 rows per page the
                user is almost always going to step one page at a
                time, and the simpler control is easier to thumb on
                mobile. */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="h-8"
                >
                  Previous
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Page {safePage + 1} of {totalPages} · {filtered.length} food
                  {filtered.length === 1 ? "" : "s"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={safePage >= totalPages - 1}
                  className="h-8"
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <CustomFoodForm
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditing(undefined);
        }}
        editing={editing}
        onSaved={() => {
          onChange?.();
          refresh();
        }}
      />

      <FoodViewDialog
        open={viewing !== null}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
        food={viewing}
        onEdit={(f) => {
          setEditing(f);
          setFormOpen(true);
        }}
      />

      <OffSearchDialog
        open={offSearchOpen}
        onOpenChange={setOffSearchOpen}
        onPick={(food) => setOffPreviewing(food)}
      />

      {/* Camera with photo-identify disabled (aiAvailable=false) — the
          My Foods context only accepts barcode-resolved foods, so the
          photo tab is suppressed to avoid mixing AI-estimated macros
          into the trusted custom-foods catalog. */}
      <CameraSheet
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        aiAvailable={false}
        pairPhoneAvailable={false}
        onFoodPicked={(food) => setOffPreviewing(food)}
        onMealPhotoResolved={() => {
          /* Photo tab is hidden; this callback can't fire. */
        }}
        onSwitchToPairPhone={() => {
          /* Pair-phone link is hidden; this callback can't fire. */
        }}
      />

      <OffSavePreviewDialog
        open={offPreviewing !== null}
        onOpenChange={(o) => {
          if (!o) setOffPreviewing(null);
        }}
        food={offPreviewing}
        onSave={handleConfirmOffSave}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{pendingDelete?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the food from My Foods. Past meal logs that already
              contain it keep their entries — only future searches will stop
              suggesting it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FoodMobileCard({
  food,
  draggable,
  onView,
  onEdit,
  onDelete,
}: {
  food: CustomFood;
  draggable: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, style, handleProps } = useSortableRow(
    food.id,
    !draggable,
  );
  return (
    <li
      ref={setNodeRef as React.Ref<HTMLLIElement>}
      style={style}
      className="flex items-start gap-3 px-4 py-3 active:bg-muted/30"
    >
      {draggable && (
        <button
          type="button"
          {...handleProps}
          className="flex h-9 w-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={`Drag to reorder ${food.name}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {food.name}
          </span>
          {food.dietKind ? (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {food.dietKind}
            </span>
          ) : (
            <span className="shrink-0 text-[10px] italic text-amber-700 dark:text-amber-400">
              unclassified
            </span>
          )}
        </div>
        {food.brand && (
          <p className="truncate text-[11px] text-muted-foreground">
            {food.brand}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
          <span className="font-medium text-foreground">
            {food.calories} kcal
          </span>
          <span style={{ color: "hsl(var(--macro-protein))" }}>
            P{food.protein}
          </span>
          <span style={{ color: "hsl(var(--macro-carbs))" }}>
            C{food.carbs}
          </span>
          <span style={{ color: "hsl(var(--macro-fat))" }}>F{food.fat}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          onClick={onView}
          aria-label={`View ${food.name}`}
          title="View details"
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          onClick={onEdit}
          aria-label={`Edit ${food.name}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Delete ${food.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function FoodTableRow({
  food,
  draggable,
  onView,
  onEdit,
  onDelete,
}: {
  food: CustomFood;
  draggable: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, style, handleProps } = useSortableRow(
    food.id,
    !draggable,
  );
  return (
    <tr
      ref={setNodeRef as React.Ref<HTMLTableRowElement>}
      style={style}
      className="transition-colors hover:bg-muted/40"
    >
      {draggable && (
        <td className="w-8 px-1 py-2.5 align-middle">
          <button
            type="button"
            {...handleProps}
            className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label={`Drag to reorder ${food.name}`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        </td>
      )}
      <td className="px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-foreground">{food.name}</span>
          {food.brand && (
            <span className="text-[11px] text-muted-foreground">
              {food.brand}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {food.dietKind ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {food.dietKind}
          </span>
        ) : (
          <span className="text-[11px] italic text-amber-700 dark:text-amber-400">
            unclassified
          </span>
        )}
      </td>
      <td
        className="px-3 py-2.5 text-center font-mono text-xs tabular-nums"
        style={{ color: "hsl(var(--macro-protein))" }}
      >
        {food.protein}g
      </td>
      <td
        className="px-3 py-2.5 text-center font-mono text-xs tabular-nums"
        style={{ color: "hsl(var(--macro-carbs))" }}
      >
        {food.carbs}g
      </td>
      <td
        className="px-3 py-2.5 text-center font-mono text-xs tabular-nums"
        style={{ color: "hsl(var(--macro-fat))" }}
      >
        {food.fat}g
      </td>
      <td className="px-3 py-2.5 text-center font-mono text-xs font-medium tabular-nums text-foreground">
        {food.calories}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={onView}
            aria-label={`View ${food.name}`}
            title="View details"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={onEdit}
            aria-label={`Edit ${food.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${food.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
