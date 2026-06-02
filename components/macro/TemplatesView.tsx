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
import { Input } from "@/components/ui/input";
import { SkeletonListRow } from "@/components/ui/skeleton";
import {
  addRecipe,
  computeSortBetween,
  deleteMealTemplate,
  listMealTemplates,
  setSortOrder,
  upsertMealTemplate,
  type MealTemplate,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { buildShareUrl } from "@/lib/template-share";
import { templateToRecipeDraft } from "@/lib/template-to-recipe";
import { useEffect, useMemo, useState } from "react";
import {
  ChefHat,
  ChevronDown,
  ChevronRight,
  GripVertical,
  LayoutGrid,
  Pencil,
  Search,
  Share2,
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
import { SortControl, sortByMode, useSortMode } from "./SortControl";
import { TemplateEditDialog } from "./TemplateEditDialog";
import { useSortableRow } from "./useSortableRow";

/** Top-level page that lists meal templates the user has saved (today
 *  the only way to interact with them is the "Apply template" dialog
 *  inside the meal planner - this view lets the user manage them
 *  outside that flow).
 *
 *  V1 capabilities: list, rename, delete, expand to see ingredients.
 *  Creation still happens from the meal planner (the "Save as template"
 *  button on a meal slot, which is the path users are already used to).
 *  A "create blank template + add foods directly here" flow needs a
 *  food-picker UI that's bigger than this Pass; tracked as a follow-up. */
type Props = {
  /** Switch the app to the Meal Plan view. Surfaced from the empty
   *  state's "Open Meal Plan" CTA so a fresh user can jump straight
   *  to the surface that creates templates. Optional - the empty
   *  state degrades to a passive sentence if not provided. */
  onGoToPlan?: () => void;
};

export function TemplatesView({ onGoToPlan }: Props = {}) {
  const [templates, setTemplates] = useState<MealTemplate[] | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<MealTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MealTemplate | null>(null);
  // Templates don't have a meaningful "type" axis (no cuisine field),
  // so only expose three of the four modes.
  const [sortMode, setSortMode] = useSortMode("sort:templates", "recent");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Re-load on mount + every realtime arrival for meal_templates. Same
  // pattern as RecipesView so the page stays consistent across devices.
  const templatesRev = useDataRev("mealTemplates");
  useEffect(() => {
    let cancelled = false;
    listMealTemplates()
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setTemplates([]);
        toast.error("Couldn't load templates. Try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, [templatesRev]);

  const filtered = useMemo(() => {
    if (!templates) return [];
    const q = search.trim().toLowerCase();
    const matched = q
      ? templates.filter((t) => t.name.toLowerCase().includes(q))
      : templates;
    return sortByMode(matched, sortMode, {
      sortOrder: (t) => t.sortOrder,
      recentField: (t) => t.updatedAt,
    });
  }, [templates, search, sortMode]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const items = filtered;
    const draggedRow = items.find((t) => t.id === active.id);
    if (!draggedRow) return;
    const without = items.filter((t) => t.id !== active.id);
    const insertAt = items.findIndex((t) => t.id === over.id);
    const before = without[insertAt - 1];
    const after = without[insertAt];
    const newOrder = computeSortBetween(
      before?.sortOrder ?? null,
      after?.sortOrder ?? null,
    );
    setTemplates((prev) =>
      prev
        ? prev.map((t) =>
            t.id === active.id ? { ...t, sortOrder: newOrder } : t,
          )
        : prev,
    );
    try {
      await setSortOrder("mealTemplates", String(active.id), newOrder);
      bumpPending();
    } catch (err) {
      reportStorageError(err);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(t: MealTemplate) {
    const prev = templates;
    setTemplates((rs) => (rs ? rs.filter((r) => r.id !== t.id) : rs));
    try {
      await deleteMealTemplate(t.id);
      bumpPending();
    } catch (err) {
      reportStorageError(err);
      setTemplates(prev);
    }
  }

  /** Convert a saved template into a recipe in one click. We don't
   *  open the recipe form first - the user can tune cuisine / notes /
   *  ingredients afterwards from the Recipes view if they want, but
   *  for the common path ("I want to share this template as a
   *  recipe") the extra modal would just be a speed bump. The toast
   *  signals success and points at where the result lives. */
  async function handleSaveAsRecipe(t: MealTemplate) {
    try {
      const draft = templateToRecipeDraft(t);
      if (draft.ingredients.length === 0) {
        toast.error("This template has no foods to convert.");
        return;
      }
      await addRecipe(draft);
      bumpPending();
      toast.success(
        `Saved "${t.name}" as a recipe. Open the Recipes view to edit.`,
      );
    } catch (err) {
      reportStorageError(err);
      toast.error("Couldn't save the recipe. Try again.");
    }
  }

  /** Mint a self-contained share URL for the template and push it
   *  through the OS share sheet (Web Share API) — falling back to
   *  the clipboard on desktop browsers without Web Share.
   *
   *  The URL embeds the template as a base64url fragment so the
   *  recipient gets a working preview + import without any
   *  server-side share row, account, or auth. See
   *  `lib/template-share.ts` for the rationale (no infrastructure,
   *  no privacy footprint, works offline). */
  async function handleShare(t: MealTemplate) {
    try {
      const baseUrl =
        typeof window !== "undefined"
          ? window.location.origin
          : "https://maqro.app";
      const url = buildShareUrl(t, baseUrl);
      const payload = {
        title: `Maqro template — ${t.name}`,
        text: `Try "${t.name}" on Maqro:`,
        url,
      };
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        (!navigator.canShare || navigator.canShare(payload))
      ) {
        await navigator.share(payload);
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied to clipboard.");
        return;
      }
      toast.error("Sharing isn't available in this browser.");
    } catch (err) {
      // AbortError = user dismissed the OS share sheet. Silent.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(
        err instanceof Error ? `Share failed: ${err.message}` : "Share failed.",
      );
    }
  }

  /** Save the full edit (name + foods). The full editor replaces the
   *  old rename-only dialog - renames are a degenerate case (foods
   *  array unchanged). Optimistic update with revert on IDB failure. */
  async function handleSaveEdit(
    t: MealTemplate,
    next: { name: string; foods: MealTemplate["foods"] },
  ) {
    const trimmedName = next.name.trim();
    if (!trimmedName) {
      setRenaming(null);
      return;
    }
    const updated: MealTemplate = {
      ...t,
      name: trimmedName,
      foods: next.foods,
      updatedAt: Date.now(),
    };
    // Optimistic update - the local saver bumps localUpdatedAt under
    // the hood so the next sync picks the row up as dirty.
    setTemplates((prev) =>
      prev ? prev.map((row) => (row.id === t.id ? updated : row)) : prev,
    );
    try {
      await upsertMealTemplate(updated);
      bumpPending();
    } catch (err) {
      reportStorageError(err);
      // Revert on failure.
      setTemplates((prev) =>
        prev ? prev.map((row) => (row.id === t.id ? t : row)) : prev,
      );
    } finally {
      setRenaming(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            Meal Templates
          </h2>
          <p className="text-xs text-muted-foreground">
            Saved bundles of foods you can apply to any meal slot from the
            planner. Create new ones with &ldquo;Save as template&rdquo; on a
            meal slot.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="pl-9"
          />
        </div>
        <SortControl
          modes={["recent", "name", "custom"]}
          active={sortMode}
          onChange={setSortMode}
        />
      </div>

      {templates === null ? (
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
          <LayoutGrid className="mx-auto h-6 w-6 text-muted-foreground/60" />
          {templates.length === 0 ? (
            <>
              <p className="mt-2 text-sm font-medium text-foreground">
                No templates yet
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                Build a meal in the planner, then tap{" "}
                <span className="font-medium">Save as template</span> on the
                slot menu to capture it.
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
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No templates match your search.
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
            items={filtered.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card">
              {filtered.map((t) => {
                const totals = totalsOf(t);
                const isExpanded = expanded.has(t.id);
                return (
                  <SortableTemplateRow
                    key={t.id}
                    template={t}
                    totals={totals}
                    isExpanded={isExpanded}
                    draggable={sortMode === "custom"}
                    onToggleExpand={() => toggleExpand(t.id)}
                    onRename={() => setRenaming(t)}
                    onSaveAsRecipe={() => void handleSaveAsRecipe(t)}
                    onShare={() => void handleShare(t)}
                    onDelete={() => setPendingDelete(t)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {renaming && (
        <TemplateEditDialog
          open
          onOpenChange={(o) => {
            if (!o) setRenaming(null);
          }}
          initialName={renaming.name}
          initialFoods={renaming.foods}
          onSave={(next) => handleSaveEdit(renaming, next)}
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
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
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
                if (pendingDelete) void handleDelete(pendingDelete);
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

function totalsOf(t: MealTemplate) {
  return t.foods.reduce(
    (acc, f) => ({
      protein: acc.protein + f.protein,
      carbs: acc.carbs + f.carbs,
      fat: acc.fat + f.fat,
      calories: acc.calories + f.calories,
    }),
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
}

function SortableTemplateRow({
  template,
  totals,
  isExpanded,
  draggable,
  onToggleExpand,
  onRename,
  onSaveAsRecipe,
  onShare,
  onDelete,
}: {
  template: MealTemplate;
  totals: { protein: number; carbs: number; fat: number; calories: number };
  isExpanded: boolean;
  draggable: boolean;
  onToggleExpand: () => void;
  onRename: () => void;
  onSaveAsRecipe: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, style, handleProps } = useSortableRow(
    template.id,
    !draggable,
  );
  return (
    <li
      ref={setNodeRef as React.Ref<HTMLLIElement>}
      style={style}
      className="px-3 py-2.5"
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        {draggable && (
          <button
            type="button"
            {...handleProps}
            className="flex h-9 w-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing sm:h-7"
            aria-label={`Drag to reorder ${template.name}`}
          >
            <GripVertical className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent sm:h-7 sm:w-7"
          aria-label={
            isExpanded ? "Collapse ingredients" : "Expand ingredients"
          }
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          ) : (
            <ChevronRight className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{template.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
            <span className="text-muted-foreground">
              {template.foods.length} food
              {template.foods.length === 1 ? "" : "s"}
            </span>
            <span className="font-medium text-foreground">
              {Math.round(totals.calories)} kcal
            </span>
            <span
              style={{ color: "hsl(var(--macro-protein))" }}
              aria-label={`${Math.round(totals.protein)} grams of protein`}
            >
              P{Math.round(totals.protein)}
            </span>
            <span
              style={{ color: "hsl(var(--macro-carbs))" }}
              aria-label={`${Math.round(totals.carbs)} grams of carbs`}
            >
              C{Math.round(totals.carbs)}
            </span>
            <span
              style={{ color: "hsl(var(--macro-fat))" }}
              aria-label={`${Math.round(totals.fat)} grams of fat`}
            >
              F{Math.round(totals.fat)}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          onClick={onRename}
          aria-label={`Edit ${template.name}`}
        >
          <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          onClick={onSaveAsRecipe}
          aria-label={`Save ${template.name} as a recipe`}
          title="Save as recipe"
          disabled={template.foods.length === 0}
        >
          <ChefHat className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          onClick={onShare}
          aria-label={`Share ${template.name}`}
          title="Share template"
          disabled={template.foods.length === 0}
        >
          <Share2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
          onClick={onDelete}
          aria-label={`Delete ${template.name}`}
        >
          <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </Button>
      </div>
      {isExpanded && (
        <ul className="ml-9 mt-2 space-y-1 border-l border-border/60 pl-3 text-xs">
          {template.foods.length === 0 ? (
            <li className="text-muted-foreground">
              (empty template - no foods)
            </li>
          ) : (
            template.foods.map((f) => (
              <li
                key={f.id}
                /* 3-column grid so portions + calories form vertical
                   tracks across rows — the previous flex-baseline
                   layout right-anchored each row to its own width and
                   read as visually ragged. */
                className="grid grid-cols-[1fr_3.5rem_4.5rem] items-baseline gap-x-3"
              >
                <span className="truncate">{f.name}</span>
                <span className="text-right font-mono tabular-nums text-muted-foreground">
                  {f.portionSize ?? 100} g
                </span>
                <span className="text-right font-mono font-medium tabular-nums text-foreground">
                  {Math.round(f.calories)} kcal
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  );
}
