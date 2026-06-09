"use client";

import type {
  DietPreference,
  PersonalInfo,
  Recipe,
} from "@/components/macro/types";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SkeletonListRow } from "@/components/ui/skeleton";
import {
  addRecipe,
  computeSortBetween,
  deleteMealSchedule,
  deleteRecipe,
  listMealSchedules,
  listPantryItems,
  listRecipes,
  setSortOrder,
  upsertRecipe,
  upsertShoppingListMeta,
  type MealSchedule,
  type PantryItem,
} from "@/lib/db";
import { recipeDietCompatibility } from "@/lib/diet";
import { formatDaysOfWeek, formatScheduleRange } from "@/lib/meal-schedule";
import { recipeShortfalls } from "@/lib/pantry/availability";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useMemo, useState } from "react";
import {
  Beef,
  CalendarClock,
  CalendarPlus,
  Check,
  ChefHat,
  Eye,
  GripVertical,
  Leaf,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  Salad,
  Search,
  Share2,
  ShoppingCart,
  Sparkles,
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
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { BatchApplyRecipeDialog } from "./BatchApplyRecipeDialog";
import { GenerateRecipeDialog } from "./GenerateRecipeDialog";
import { ImportRecipeDialog } from "./ImportRecipeDialog";
import { RecipeForm, type RecipeDraft } from "./RecipeForm";
import { RecipeViewDialog } from "./RecipeViewDialog";
import { ShareRecipeDialog } from "./ShareRecipeDialog";
import { SortControl, sortByMode, useSortMode } from "./SortControl";
import { UpgradeDialog } from "./UpgradeDialog";
import { useSortableRow } from "./useSortableRow";

type Props = {
  profile: PersonalInfo;
  /** The user's current-day meal slot layout. Passed straight to the
   *  Batch-apply dialog so it can render the slot picker and use the
   *  same scaffold when seeding new days. */
  currentMeals: readonly import("./types").Meal[];
};

const DIET_LABEL: Record<DietPreference, string> = {
  omnivore: "Omnivore",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian",
  carnivore: "Carnivore",
};

function totalKcal(r: Recipe): number {
  return r.ingredients.reduce(
    (acc, ing) => acc + (ing.macrosPer100g.calories * ing.portionGrams) / 100,
    0,
  );
}

/** The strictest of {vegan, vegetarian, omnivore} a recipe satisfies — drives
 *  the card's diet badge. Derived from the ingredients' `dietKind` snapshots
 *  via `recipeDietCompatibility` (vegan ⊂ vegetarian ⊂ omnivore). */
function recipeDietBadge(recipe: Recipe): "vegan" | "vegetarian" | "omnivore" {
  const diets = recipeDietCompatibility(recipe);
  if (diets.has("vegan")) return "vegan";
  if (diets.has("vegetarian")) return "vegetarian";
  return "omnivore";
}

const DIET_BADGE = {
  vegan: {
    icon: Leaf,
    label: DIET_LABEL.vegan,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  vegetarian: {
    icon: Salad,
    label: DIET_LABEL.vegetarian,
    className: "text-lime-600 dark:text-lime-400",
  },
  omnivore: {
    icon: Beef,
    label: DIET_LABEL.omnivore,
    className: "text-muted-foreground",
  },
} as const;

export function RecipesView({ profile, currentMeals }: Props) {
  const [recipes, setRecipes] = useState<Array<
    Recipe & { sortOrder?: number }
  > | null>(null);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Owned here (not inside ImportRecipeDialog) so the import dialog
  // can cleanly close itself and signal "open upgrade prompt" with
  // a single callback. Mounting UpgradeDialog at the parent level
  // also matches the pattern macro-calculator.tsx already uses for
  // the AI-cap and Settings upgrade triggers.
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);
  // Tracks when the form was opened from the URL-import preview, so
  // RecipeForm can surface a "Back to preview" button that drops the
  // user onto the still-mounted ImportRecipeDialog. Cleared whenever
  // the form closes, so subsequent "edit recipe" / "new recipe"
  // sessions don't inherit the back button.
  const [openedFromImport, setOpenedFromImport] = useState(false);
  const [editing, setEditing] = useState<RecipeDraft | undefined>(undefined);
  const [sharing, setSharing] = useState<Recipe | null>(null);
  const [viewing, setViewing] = useState<Recipe | null>(null);
  const [batchApplying, setBatchApplying] = useState<Recipe | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<MealSchedule | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<Recipe | null>(null);
  const [sharedOnly, setSharedOnly] = useState(false);
  const [sortMode, setSortMode] = useSortMode("sort:recipes", "recent");
  // Drag distance gate keeps the click handlers on the row (Edit /
  // Delete buttons) working even when the row is sortable - click on
  // the buttons doesn't initiate a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Load on mount, after save/delete (via setRecipes), and when a
  // peer device's recipe change arrives via realtime (recipesRev bump).
  const recipesRev = useDataRev("recipes");
  useEffect(() => {
    let cancelled = false;
    listRecipes()
      .then((rows) => {
        if (!cancelled) setRecipes(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setRecipes([]);
        // Surface the failure instead of silently rendering the
        // "no recipes yet" empty state — that empty state looks like
        // "you haven't added any" to the user, not "the load broke."
        toast.error("Couldn't load recipes. Try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, [recipesRev]);

  // Meal schedules — the "Scheduled" management list below the filters.
  const [schedules, setSchedules] = useState<MealSchedule[]>([]);
  const schedulesRev = useDataRev("mealSchedules");
  useEffect(() => {
    let cancelled = false;
    listMealSchedules()
      .then((rows) => {
        if (!cancelled) setSchedules(rows);
      })
      .catch(() => {
        if (!cancelled) setSchedules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [schedulesRev]);

  // Pantry inventory, for the per-schedule availability check below.
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const pantryRev = useDataRev("pantryItems");
  useEffect(() => {
    let cancelled = false;
    listPantryItems()
      .then((rows) => {
        if (!cancelled) setPantry(rows);
      })
      .catch(() => {
        if (!cancelled) setPantry([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pantryRev]);

  // Edit a schedule: resolve its recipe and open the scheduler pre-filled.
  const editSchedule = (s: MealSchedule) => {
    const recipe = recipes?.find((r) => r.id === s.recipeId);
    if (!recipe) {
      toast.error("That recipe was removed.");
      return;
    }
    setBatchApplying(recipe);
    setEditingSchedule(s);
  };

  // Cancel a schedule outright — it's a plan, not logged data, so no confirm.
  const cancelSchedule = async (s: MealSchedule) => {
    try {
      await deleteMealSchedule(s.id);
      bumpPending();
      toast.success("Schedule canceled.");
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't cancel the schedule.");
    }
  };

  // Total shared count surfaces in the filter chip ("Shared (3)") so
  // the user has a glance-able answer to "how many of my recipes are
  // out in the world?" - computed off the full unfiltered list so the
  // count doesn't move when the user types in the search box.
  const sharedCount = useMemo(
    () => recipes?.filter((r) => r.shareSlug).length ?? 0,
    [recipes],
  );

  const filtered = useMemo(() => {
    if (!recipes) return [];
    const q = search.trim().toLowerCase();
    let matched = q
      ? recipes.filter((r) => r.name.toLowerCase().includes(q))
      : recipes;
    if (sharedOnly) matched = matched.filter((r) => r.shareSlug);
    return sortByMode(matched, sortMode, {
      sortOrder: (r) => r.sortOrder,
      typeKey: (r) => r.cuisine,
      // "Recent" for recipes means most-recently-edited (updatedAt)
      // rather than created - matches the current default behavior.
      recentField: (r) => r.updatedAt,
    });
  }, [recipes, search, sharedOnly, sortMode]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const items = filtered;
    const overIdx = items.findIndex((r) => r.id === over.id);
    if (overIdx === -1) return;
    // When inserting into the middle, the new neighbors are the rows
    // around the drop position. Active was removed conceptually so we
    // pick prev/next from the position the row will land at.
    const draggedRow = items.find((r) => r.id === active.id);
    if (!draggedRow) return;
    const without = items.filter((r) => r.id !== active.id);
    const insertAt = items.findIndex((r) => r.id === over.id);
    const before = without[insertAt - 1];
    const after = without[insertAt];
    const newOrder = computeSortBetween(
      before?.sortOrder ?? null,
      after?.sortOrder ?? null,
    );
    // Optimistic update so the list visibly reorders before IDB writes.
    setRecipes((prev) =>
      prev
        ? prev.map((r) =>
            r.id === active.id ? { ...r, sortOrder: newOrder } : r,
          )
        : prev,
    );
    try {
      await setSortOrder("recipes", String(active.id), newOrder);
      bumpPending();
    } catch (err) {
      reportStorageError(err);
    }
  }

  async function handleSave(draft: {
    name: string;
    ingredients: Recipe["ingredients"];
    cuisine?: string;
    notes?: string;
    sourceUrl?: string;
    servings?: number;
    prepTimeMinutes?: number;
  }) {
    if (editing?.id) {
      // Edit path - keep id, bump updatedAt. `upsertRecipe` is a full-
      // row replace under the hood (db.put), so we must explicitly
      // carry over fields the edit form doesn't surface: shareSlug,
      // shareVisibility, sortOrder. Without this, editing a recipe
      // silently revoked its share link AND lost its drag-sorted
      // position - both fields would be omitted from `next`, the IDB
      // row would replace as undefined, and the next sync push would
      // send `share_slug: null` / `sort_order: null` to the server.
      const existing = recipes?.find((r) => r.id === editing.id);
      const next: Recipe & { sortOrder?: number } = {
        id: editing.id,
        name: draft.name,
        ingredients: draft.ingredients,
        cuisine: draft.cuisine,
        notes: draft.notes,
        sourceUrl: draft.sourceUrl,
        servings: draft.servings,
        prepTimeMinutes: draft.prepTimeMinutes,
        shareSlug: existing?.shareSlug,
        shareVisibility: existing?.shareVisibility,
        sortOrder: existing?.sortOrder,
        createdAt: editing.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      await upsertRecipe(next);
      setRecipes((prev) =>
        prev ? prev.map((r) => (r.id === next.id ? next : r)) : [next],
      );
    } else {
      // Create path - mint id via addRecipe.
      const id = await addRecipe({
        name: draft.name,
        ingredients: draft.ingredients,
        cuisine: draft.cuisine,
        notes: draft.notes,
        sourceUrl: draft.sourceUrl,
        servings: draft.servings,
        prepTimeMinutes: draft.prepTimeMinutes,
      });
      const now = Date.now();
      const created: Recipe = {
        id,
        name: draft.name,
        ingredients: draft.ingredients,
        cuisine: draft.cuisine,
        notes: draft.notes,
        sourceUrl: draft.sourceUrl,
        servings: draft.servings,
        prepTimeMinutes: draft.prepTimeMinutes,
        createdAt: now,
        updatedAt: now,
      };
      setRecipes((prev) => (prev ? [created, ...prev] : [created]));
    }
    bumpPending();
    toast.success(editing?.id ? "Recipe updated" : "Recipe saved");
    setEditing(undefined);
  }

  async function handleDelete(id: string) {
    const prev = recipes;
    setRecipes((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
    try {
      await deleteRecipe(id);
      bumpPending();
    } catch (err) {
      reportStorageError(err);
      setRecipes(prev);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Recipes</h2>
          <p className="text-xs text-muted-foreground">
            Named bundles of ingredients you can apply to any meal slot.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGenerateOpen(true)}
            className="flex-1 sm:flex-none"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Generate
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
            className="flex-1 sm:flex-none"
          >
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            Import URL
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
            className="flex-1 sm:flex-none"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New recipe
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Shared filter chip. Hidden when there are no shared
              recipes - no point offering a filter that matches
              nothing. The count is computed off the unfiltered list
              so it doesn't move when the search box changes. */}
          {sharedCount > 0 && (
            <button
              type="button"
              onClick={() => setSharedOnly((v) => !v)}
              aria-pressed={sharedOnly}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 ${
                sharedOnly
                  ? "border-foreground/40 bg-accent text-foreground"
                  : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40"
              }`}
              title={
                sharedOnly
                  ? "Show all recipes"
                  : `Show only the ${sharedCount} shared recipe${sharedCount === 1 ? "" : "s"}`
              }
            >
              <Share2 className="h-3.5 w-3.5" />
              Shared ({sharedCount})
            </button>
          )}
          <SortControl
            modes={["recent", "name", "type", "custom"]}
            active={sortMode}
            onChange={setSortMode}
          />
        </div>
      </div>

      {schedules.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Scheduled ({schedules.length})
          </h3>
          <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card">
            {schedules.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                recipe={recipes?.find((r) => r.id === s.recipeId)}
                pantry={pantry}
                onEdit={() => editSchedule(s)}
                onCancel={() => void cancelSchedule(s)}
              />
            ))}
          </ul>
        </section>
      )}

      {recipes === null ? (
        // Four placeholder rows roughly matching the actual
        // recipe-card layout - name + meta line - so the list
        // settles without a reflow shock when data arrives.
        <div
          className="space-y-2 px-1 py-3"
          aria-busy="true"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonListRow key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 px-4 py-10 text-center">
          <ChefHat className="mx-auto h-6 w-6 text-muted-foreground/60" />
          {recipes.length === 0 ? (
            // Fresh user, no recipes at all - surface both creation
            // paths as buttons so they don't have to scroll back up
            // to find the header CTAs.
            <>
              <p className="mt-2 text-sm font-medium text-foreground">
                No recipes yet
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                Save your regular dishes as named recipes so you can apply them
                to any meal slot with one tap.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setGenerateOpen(true)}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Generate with AI
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setEditing(undefined);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Build manually
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {sharedOnly
                ? "No shared recipes match your search."
                : "No recipes match your search."}
            </p>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <SortableContext
            items={filtered.map((r) => r.id)}
            strategy={rectSortingStrategy}
          >
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((r) => (
                <SortableRecipeRow
                  key={r.id}
                  recipe={r}
                  draggable={sortMode === "custom"}
                  onView={() => setViewing(r)}
                  onEdit={() => {
                    setEditing(r);
                    setFormOpen(true);
                  }}
                  onShare={() => setSharing(r)}
                  onBatchApply={() => setBatchApplying(r)}
                  onDelete={() => setPendingDelete(r)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <RecipeForm
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) {
            setEditing(undefined);
            setOpenedFromImport(false);
          }
        }}
        initial={editing}
        onSave={async (draft) => {
          await handleSave(draft);
          // Successful save dismisses the import preview too - the
          // user's done with the import flow at that point. Without
          // this, the preview would linger after save.
          if (openedFromImport) setImportOpen(false);
        }}
        onBack={openedFromImport ? () => setFormOpen(false) : undefined}
        onBackLabel="Back to preview"
      />
      <GenerateRecipeDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        profile={profile}
        onDraft={(draft) => {
          setEditing(draft);
          setFormOpen(true);
        }}
      />
      <ImportRecipeDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onDraft={(draft) => {
          setEditing(draft);
          setOpenedFromImport(true);
          setFormOpen(true);
        }}
        onPremiumRequired={() => setUpgradePromptOpen(true)}
        onSignInRequired={() => {
          // Cookie-session expired mid-use - bounce to /login with a
          // return path so the user lands back on the recipes view
          // after authenticating. Hard navigation (not router.push)
          // because the cookie state needs a full reload to settle.
          window.location.assign(
            `/login?next=${encodeURIComponent("/app?view=recipes")}`,
          );
        }}
      />
      <UpgradeDialog
        open={upgradePromptOpen}
        onOpenChange={setUpgradePromptOpen}
        reason="import"
        defaultPlan="plus"
      />
      <ShareRecipeDialog
        open={sharing !== null}
        onOpenChange={(o) => {
          if (!o) setSharing(null);
        }}
        recipe={sharing}
      />
      <RecipeViewDialog
        open={viewing !== null}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
        recipe={viewing}
        onEdit={(r) => {
          setEditing(r);
          setFormOpen(true);
        }}
      />
      {batchApplying && (
        <BatchApplyRecipeDialog
          open={batchApplying !== null}
          onOpenChange={(o) => {
            if (!o) {
              setBatchApplying(null);
              setEditingSchedule(null);
            }
          }}
          recipe={batchApplying}
          currentMeals={currentMeals}
          editing={editingSchedule ?? undefined}
        />
      )}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recipe?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will be permanently deleted on all your devices.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScheduleRow({
  schedule,
  recipe,
  pantry,
  onEdit,
  onCancel,
}: {
  schedule: MealSchedule;
  recipe: Recipe | undefined;
  pantry: PantryItem[];
  onEdit: () => void;
  onCancel: () => void;
}) {
  const [added, setAdded] = useState(false);
  const shortfalls = recipe
    ? recipeShortfalls(recipe, pantry, schedule.scale)
    : [];

  const addMissing = async () => {
    try {
      await Promise.all(
        shortfalls.map((s) =>
          upsertShoppingListMeta(s.name, {
            extraQty: Math.round(s.neededGrams),
            extraUnit: "g",
          }),
        ),
      );
      setAdded(true);
      toast.success(
        `Added ${shortfalls.length} item${
          shortfalls.length === 1 ? "" : "s"
        } to your shopping list`,
      );
    } catch {
      toast.error("Couldn't add to the shopping list.");
    }
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {schedule.recipeName}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {schedule.mealNames
              .map((n) => n.charAt(0).toUpperCase() + n.slice(1))
              .join(", ")}{" "}
            · {formatDaysOfWeek(schedule.daysOfWeek)} ·{" "}
            {formatScheduleRange(schedule.startDate, schedule.endDate)}
            {schedule.scale !== 1
              ? ` · ×${schedule.scale.toFixed(2).replace(/\.?0+$/, "")}`
              : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="sr-only">Edit schedule</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-destructive"
          onClick={onCancel}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only">Cancel schedule</span>
        </Button>
      </div>

      {/* Pantry availability — only when the user actually keeps a pantry,
          else every schedule would read as "short on everything". */}
      {recipe &&
        pantry.length > 0 &&
        (shortfalls.length === 0 ? (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3 shrink-0" />
            Everything is in your pantry
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
              <ShoppingCart className="h-3 w-3 shrink-0" />
              Short on {shortfalls.map((s) => s.name).join(", ")}
            </span>
            {added ? (
              <span className="text-[11px] text-muted-foreground">
                Added to list
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void addMissing()}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Add to list
              </button>
            )}
          </div>
        ))}
    </li>
  );
}

function SortableRecipeRow({
  recipe,
  draggable,
  onView,
  onEdit,
  onShare,
  onBatchApply,
  onDelete,
}: {
  recipe: Recipe & { sortOrder?: number };
  draggable: boolean;
  onView: () => void;
  onEdit: () => void;
  onShare: () => void;
  onBatchApply: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, style, handleProps } = useSortableRow(
    recipe.id,
    !draggable,
  );
  const diet = recipeDietBadge(recipe);
  const {
    icon: DietIcon,
    label: dietLabel,
    className: dietClass,
  } = DIET_BADGE[diet];
  const kcal = totalKcal(recipe);
  return (
    <li
      ref={setNodeRef as React.Ref<HTMLLIElement>}
      style={style}
      className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-border"
    >
      {/* Top row: diet badge (left) · cuisine + drag handle + actions (right). */}
      <div className="flex items-center justify-between gap-1">
        {recipe.ingredients.length > 0 ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${dietClass}`}
          >
            <DietIcon className="h-3.5 w-3.5" />
            {dietLabel}
          </span>
        ) : (
          <span />
        )}
        <div className="flex min-w-0 items-center gap-0.5">
          {recipe.cuisine && (
            <Badge
              variant="secondary"
              className="min-w-0 shrink truncate text-[10px] font-normal"
            >
              {recipe.cuisine}
            </Badge>
          )}
          {draggable && (
            <button
              type="button"
              {...handleProps}
              className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
              aria-label={`Drag to reorder ${recipe.name}`}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                aria-label={`Actions for ${recipe.name}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onView}>
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                View
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onShare}>
                <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
                {recipe.shareSlug ? "Manage share" : "Share"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onBatchApply}>
                <CalendarPlus className="h-3.5 w-3.5 text-muted-foreground" />
                Schedule
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Name — taps through to the detail view. */}
      <button
        type="button"
        onClick={onView}
        className="block min-w-0 text-left"
      >
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {recipe.name}
        </span>
      </button>

      <div className="mt-auto flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>
          {recipe.ingredients.length} ingredient
          {recipe.ingredients.length === 1 ? "" : "s"}
        </span>
        <span>·</span>
        <span>{Math.round(kcal)} kcal</span>
      </div>
    </li>
  );
}
