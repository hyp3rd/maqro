"use client";

import {
  CUISINES,
  type Food,
  type FoodKind,
  type Recipe,
  type RecipeIngredient,
} from "@/components/macro/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFoodSearch } from "@/hooks/use-food-search";
import { classifyFood } from "@/lib/diet";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Loader2, Plus, Replace, Trash2, X } from "lucide-react";
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
import { useSortableRow } from "./useSortableRow";

const NAME_MAX = 80;
// 3000 chars fits a typical recipe's full instruction set + a URL +
// metadata when the import flow pre-fills notes. The Postgres column
// is unconstrained `text` (see migration 0003); this cap is purely a
// client-side guardrail against a runaway paste. The historical 500
// was set before the URL-import flow existed and was the bottleneck
// that chopped imported recipes mid-step.
const NOTES_MAX = 3000;
const PORTION_MIN = 5;
const PORTION_MAX = 500;
const DEFAULT_PORTION = 100;

/** Recipe draft passed in from create / edit / AI-generate flows. The
 *  AI generate route returns this shape (no id/timestamps yet).
 *
 *  `autoMatched` is a transient form-state hint, not part of the
 *  persisted Recipe - the URL-import flow sets it when the
 *  ingredient rows were populated by the catalog matcher so the
 *  form can surface a "verify before saving" banner. Stripped at
 *  save time. */
export type RecipeDraft = Omit<Recipe, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<Recipe, "id" | "createdAt" | "updatedAt">> & {
    autoMatched?: boolean;
  };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the form is in edit mode (id present) or pre-fill mode
   *  (AI draft, id absent). When undefined, the form is creating fresh. */
  initial?: RecipeDraft;
  /** Persist callback. Receives the recipe shape without id/timestamps -
   *  the caller decides whether to addRecipe (mint id) or upsertRecipe
   *  (keep id). */
  onSave: (draft: {
    name: string;
    ingredients: RecipeIngredient[];
    cuisine?: string;
    notes?: string;
    sourceUrl?: string;
    servings?: number;
    prepTimeMinutes?: number;
  }) => Promise<void>;
  /** Optional back-navigation hook. When set, the dialog footer
   *  surfaces a "← Back" button alongside the usual Cancel/Save.
   *  Today this is wired only by the URL-import flow, where the
   *  preview dialog stays mounted underneath the form - clicking
   *  Back drops the user onto the preview so they can re-check the
   *  parsed ingredients or step list without losing their place. */
  onBack?: () => void;
  /** Label for the back button. Defaults to "Back" but the caller
   *  can supply something more specific ("Back to preview"). */
  onBackLabel?: string;
};

/** Boundary coercion for the structured integer fields (servings,
 *  prep time). Returns undefined for empty / non-numeric / out-of-
 *  range input - the persisted recipe stores null in that case,
 *  which the DB CHECK constraints in migration 0039 allow. */
function parseStructuredInt(
  raw: string,
  bounds: { min: number; max: number },
): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return undefined;
  if (n < bounds.min || n > bounds.max) return undefined;
  return n;
}

function deriveKind(food: Food): FoodKind | undefined {
  if (food.dietKind) return food.dietKind;
  const k = classifyFood(food);
  return k === "unknown" ? undefined : k;
}

function foodToIngredient(food: Food, grams: number): RecipeIngredient {
  return {
    foodName: food.name,
    macrosPer100g: {
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      calories: food.calories,
    },
    portionGrams: grams,
    dietKind: deriveKind(food),
    // Freeze the source food's per-100g micronutrients alongside the
    // macros so the recipe carries them when applied. Absent when the
    // food had no OFF micro data.
    micronutrientsPer100g: food.micronutrients,
  };
}

function ingredientMacros(ing: RecipeIngredient) {
  const r = ing.portionGrams / 100;
  return {
    protein: ing.macrosPer100g.protein * r,
    carbs: ing.macrosPer100g.carbs * r,
    fat: ing.macrosPer100g.fat * r,
    calories: ing.macrosPer100g.calories * r,
  };
}

function totalMacros(ingredients: RecipeIngredient[]) {
  return ingredients.reduce(
    (acc, ing) => {
      const m = ingredientMacros(ing);
      return {
        protein: acc.protein + m.protein,
        carbs: acc.carbs + m.carbs,
        fat: acc.fat + m.fat,
        calories: acc.calories + m.calories,
      };
    },
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
}

function clampPortion(g: number): number {
  if (!Number.isFinite(g)) return PORTION_MIN;
  return Math.max(PORTION_MIN, Math.min(PORTION_MAX, Math.round(g)));
}

/** Form-internal ingredient shape with a stable runtime key. The key
 *  isn't persisted - it just lets dnd-kit identify each row across
 *  reorders. `withKey` assigns one when an ingredient enters the form
 *  (from `initial` or after a search-pick) and the save path strips
 *  the key before handing the array off to `onSave`. */
type DraftIngredient = RecipeIngredient & { _key: string };

function withKey(ing: RecipeIngredient): DraftIngredient {
  return { ...ing, _key: crypto.randomUUID() };
}

export function RecipeForm({
  open,
  onOpenChange,
  initial,
  onSave,
  onBack,
  onBackLabel,
}: Props) {
  // Outer wrapper just owns the Dialog. The actual form is mounted only
  // while `open` is true, so its `useState(initial?.x ?? "")` reads serve
  // as the per-open initial values - no `setState-in-effect` resync needed.
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-2xl">
        {open && (
          <RecipeFormBody
            initial={initial}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
            onBack={onBack}
            onBackLabel={onBackLabel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecipeFormBody({
  initial,
  onSave,
  onClose,
  onBack,
  onBackLabel,
}: {
  initial?: RecipeDraft;
  onSave: Props["onSave"];
  onClose: () => void;
  onBack?: () => void;
  onBackLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [cuisine, setCuisine] = useState(initial?.cuisine ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Stored as strings so the controlled inputs allow empty + partial
  // typing (e.g. clearing the field mid-edit). Coerced to number /
  // undefined inside the save handler so the persisted shape stays
  // typed. Empty / non-numeric input → undefined → null in the DB.
  const [servings, setServings] = useState<string>(
    initial?.servings != null ? String(initial.servings) : "",
  );
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<string>(
    initial?.prepTimeMinutes != null ? String(initial.prepTimeMinutes) : "",
  );
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  // Sticky banner shown when the form was pre-filled by the URL
  // importer's auto-matcher. Cleared on first interaction with the
  // ingredient list - once the user has touched a row, they've
  // implicitly acknowledged the verification ask and the banner
  // is just visual noise. Persisted to false after that point.
  const [showAutoMatchBanner, setShowAutoMatchBanner] = useState(
    initial?.autoMatched === true,
  );
  // The persisted shape doesn't include a stable per-ingredient id -
  // RecipeIngredient is just (foodName, macrosPer100g, portionGrams,
  // dietKind). For drag-and-drop reorder we need stable keys that
  // survive across renders + reorders, so we tack on a runtime-only
  // `_key` (UUID) and strip it back out before persisting in onSave.
  const [ingredients, setIngredients] = useState<DraftIngredient[]>(
    (initial?.ingredients ?? []).map(withKey),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Ingredient picker ──────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const { results, isSearchingRemote } = useFoodSearch(query);

  // ─── Replace flow ───────────────────────────────────────────────────────
  // When the user clicks the "Replace" icon on an ingredient row, the
  // row swaps to an inline search input scoped to that index. Picking
  // a result swaps the ingredient (preserving the existing portion
  // size) and clears `replacingIdx`. Cancel via the X button or by
  // pressing Escape.
  const [replacingIdx, setReplacingIdx] = useState<number | null>(null);
  const [replaceQuery, setReplaceQuery] = useState("");
  const { results: replaceResults, isSearchingRemote: replaceSearchingRemote } =
    useFoodSearch(replaceQuery);

  // Drag-to-reorder sensor - same 6 px activation distance the rest of
  // the project uses so a click on the grip doesn't accidentally
  // trigger a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = ingredients.findIndex((ing) => ing._key === active.id);
    const toIdx = ingredients.findIndex((ing) => ing._key === over.id);
    if (fromIdx === -1 || toIdx === -1) return;
    setIngredients((prev) => {
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  function handleStartReplace(idx: number) {
    setReplacingIdx(idx);
    setReplaceQuery("");
  }

  function handleCancelReplace() {
    setReplacingIdx(null);
    setReplaceQuery("");
  }

  /** Swap the ingredient at `idx` with a new food. Keeps the existing
   *  portion size so the user doesn't have to re-enter it (the
   *  assumption is that a replace = same-quantity substitution; if
   *  they want a different gram count they can edit after). */
  function handleReplace(idx: number, food: Food) {
    setIngredients((prev) =>
      prev.map((ing, i) =>
        i === idx
          ? { ...foodToIngredient(food, ing.portionGrams), _key: ing._key }
          : ing,
      ),
    );
    handleCancelReplace();
  }

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!showResults) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showResults]);

  function handlePick(food: Food) {
    setIngredients((prev) => [
      ...prev,
      withKey(foodToIngredient(food, DEFAULT_PORTION)),
    ]);
    setQuery("");
    setShowResults(false);
  }

  function handlePortionChange(idx: number, raw: string) {
    const g = clampPortion(parseFloat(raw));
    setIngredients((prev) =>
      prev.map((ing, i) => (i === idx ? { ...ing, portionGrams: g } : ing)),
    );
  }

  function handleRemove(idx: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  }

  const totals = useMemo(() => totalMacros(ingredients), [ingredients]);
  const isEdit = !!initial?.id;
  const canSave = name.trim().length > 0 && ingredients.length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      // String → number coercion at the boundary. Empty / non-numeric /
      // out-of-range values become undefined → null in the DB,
      // matching the CHECK constraints in migration 0039.
      const servingsNum = parseStructuredInt(servings, { min: 1, max: 100 });
      const prepMinutesNum = parseStructuredInt(prepTimeMinutes, {
        min: 0,
        max: 60 * 24,
      });
      const trimmedUrl = sourceUrl.trim();
      const cleanSourceUrl = trimmedUrl.startsWith("https://")
        ? trimmedUrl
        : undefined;
      await onSave({
        name: name.trim().slice(0, NAME_MAX),
        // Strip the form-only `_key` before persisting - it's a
        // runtime identifier for dnd-kit, not part of the saved
        // recipe shape.
        ingredients: ingredients.map(({ _key, ...rest }) => {
          void _key;
          return rest;
        }),
        cuisine: cuisine.trim() || undefined,
        notes: notes.trim() ? notes.trim().slice(0, NOTES_MAX) : undefined,
        sourceUrl: cleanSourceUrl,
        servings: servingsNum,
        prepTimeMinutes: prepMinutesNum,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recipe.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TooltipProvider
      delayDuration={400}
      skipDelayDuration={150}
    >
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit recipe" : "New recipe"}</DialogTitle>
          <DialogDescription>
            Build a recipe from your foods. Macros are computed per 100g ×
            portion - no estimates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="recipe-name"
              className="text-xs font-medium"
            >
              Name
            </Label>
            <Input
              id="recipe-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              placeholder="e.g. Chicken & oats bowl"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="recipe-cuisine"
              className="text-xs font-medium"
            >
              Cuisine (optional)
            </Label>
            <Input
              id="recipe-cuisine"
              list="cuisine-suggestions"
              value={cuisine}
              onChange={(e) => setCuisine(e.target.value)}
              placeholder="e.g. Italian"
            />
            <datalist id="cuisine-suggestions">
              {CUISINES.map((c) => (
                <option
                  key={c}
                  value={c}
                />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="recipe-servings"
                className="text-xs font-medium"
              >
                Servings (optional)
              </Label>
              <Input
                id="recipe-servings"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                placeholder="e.g. 4"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="recipe-prep-time"
                className="text-xs font-medium"
              >
                Prep time (min, optional)
              </Label>
              <Input
                id="recipe-prep-time"
                type="number"
                inputMode="numeric"
                min={0}
                max={60 * 24}
                step={1}
                value={prepTimeMinutes}
                onChange={(e) => setPrepTimeMinutes(e.target.value)}
                placeholder="e.g. 45"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="recipe-source-url"
              className="text-xs font-medium"
            >
              Source URL (optional)
            </Label>
            <Input
              id="recipe-source-url"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
              // The save handler rejects anything not starting with
              // https:// - surface that here so the user isn't
              // surprised at submit time.
              pattern="https://.*"
            />
            <p className="text-[10px] text-muted-foreground">
              https:// only. Auto-filled when you import from URL.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="recipe-notes"
              className="text-xs font-medium"
            >
              Prep notes (optional)
              <span className="ml-2 text-[10px] text-muted-foreground">
                {notes.length}/{NOTES_MAX}
              </span>
            </Label>
            <Textarea
              id="recipe-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
              placeholder="1–3 sentences on how to prep this."
              rows={3}
            />
          </div>

          {/* ─── Ingredient picker ───────────────────────────────── */}
          <div className="space-y-2">
            {showAutoMatchBanner && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200"
              >
                <span aria-hidden>⚠️</span>
                <div className="flex-1">
                  <strong className="font-medium">
                    Auto-matched ingredients - verify before saving.
                  </strong>{" "}
                  The matcher uses the built-in catalog and rough unit
                  conversions (cups/tbsp default to water density). Click an
                  ingredient&apos;s portion or the replace icon to correct
                  anything that&apos;s off.
                </div>
                <button
                  type="button"
                  onClick={() => setShowAutoMatchBanner(false)}
                  className="rounded px-1 text-amber-900/70 hover:bg-amber-500/10 hover:text-amber-900 dark:text-amber-200/70 dark:hover:text-amber-100"
                  aria-label="Dismiss verification notice"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <Label className="text-xs font-medium">Ingredients</Label>
            <div
              ref={pickerRef}
              className="relative"
            >
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Search built-in, your foods, and Open Food Facts…"
              />
              {isSearchingRemote && query && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {showResults && query && results.length > 0 && (
                <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border border-border/60 bg-popover shadow-lg">
                  <ul className="py-1">
                    {results.map((food) => (
                      <li key={food.id ?? food.name}>
                        <button
                          type="button"
                          onClick={() => handlePick(food)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm">
                                {food.name}
                              </span>
                              {food.source && (
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 text-[9px] font-medium uppercase tracking-wide"
                                >
                                  {food.source}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                              {Math.round(food.calories)} kcal · P
                              {food.protein.toFixed(1)} · C
                              {food.carbs.toFixed(1)} · F{food.fat.toFixed(1)}
                              <span className="ml-1 text-muted-foreground/60">
                                / 100g
                              </span>
                            </div>
                          </div>
                          <Plus className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {ingredients.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                Search above to add ingredients.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={ingredients.map((ing) => ing._key)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-1.5">
                    {ingredients.map((ing, idx) => (
                      <IngredientRow
                        key={ing._key}
                        ing={ing}
                        idx={idx}
                        replacing={replacingIdx === idx}
                        replaceQuery={replaceQuery}
                        replaceResults={replaceResults}
                        replaceSearchingRemote={replaceSearchingRemote}
                        onPortionChange={(raw) => handlePortionChange(idx, raw)}
                        onRemove={() => handleRemove(idx)}
                        onStartReplace={() => handleStartReplace(idx)}
                        onCancelReplace={handleCancelReplace}
                        onReplaceQueryChange={setReplaceQuery}
                        onReplace={(food) => handleReplace(idx, food)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}

            {ingredients.length > 0 && (
              <div
                className={cn(
                  "rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px]",
                  "tabular-nums text-muted-foreground",
                )}
              >
                Total: {Math.round(totals.calories)} kcal · P
                {totals.protein.toFixed(1)} · C{totals.carbs.toFixed(1)} · F
                {totals.fat.toFixed(1)}
              </div>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {onBack && (
            // Back nudges the user to the upstream dialog (today: the
            // import preview) WITHOUT discarding their form state. The
            // outer flow keeps the upstream dialog mounted underneath
            // this one, so "back" is just "close this layer".
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={busy}
              className="mr-auto"
            >
              ← {onBackLabel ?? "Back"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSave}
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Save recipe"}
          </Button>
        </DialogFooter>
      </form>
    </TooltipProvider>
  );
}

/** A single ingredient row inside the recipe form. Three modes:
 *
 *    - **Normal**: drag handle + name + macros + portion input +
 *      [Replace] [Remove] buttons.
 *    - **Replacing**: row collapses to an inline search input scoped
 *      to this position. Picking a result swaps the ingredient
 *      in-place; cancel restores the normal row.
 *
 *  Drag-to-reorder is wired through `useSortableRow` - the same
 *  helper RecipesView and TemplatesView use. Drag is disabled while
 *  the row is in replace mode so the search input clicks don't
 *  trigger drag activation. */
function IngredientRow({
  ing,
  idx,
  replacing,
  replaceQuery,
  replaceResults,
  replaceSearchingRemote,
  onPortionChange,
  onRemove,
  onStartReplace,
  onCancelReplace,
  onReplaceQueryChange,
  onReplace,
}: {
  ing: DraftIngredient;
  idx: number;
  replacing: boolean;
  replaceQuery: string;
  replaceResults: Food[];
  replaceSearchingRemote: boolean;
  onPortionChange: (raw: string) => void;
  onRemove: () => void;
  onStartReplace: () => void;
  onCancelReplace: () => void;
  onReplaceQueryChange: (q: string) => void;
  onReplace: (food: Food) => void;
}) {
  // Disable drag while replacing so the search input + result list
  // are interactive (the pointer sensor would otherwise hijack clicks
  // past the 6 px activation distance).
  const { setNodeRef, style, handleProps, isDragging } = useSortableRow(
    ing._key,
    replacing,
  );
  const m = ingredientMacros(ing);

  return (
    <li
      ref={setNodeRef as React.Ref<HTMLLIElement>}
      style={style}
      className={cn(
        "rounded-md border border-border/60 bg-card transition-shadow",
        isDragging && "shadow-lg",
      )}
    >
      {replacing ? (
        <div className="px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Replace{" "}
              <span className="font-mono text-foreground">{ing.foodName}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={onCancelReplace}
              aria-label="Cancel replace"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="relative">
            <Input
              value={replaceQuery}
              onChange={(e) => onReplaceQueryChange(e.target.value)}
              placeholder="Search a replacement…"
              autoFocus
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === "Escape") onCancelReplace();
              }}
            />
            {replaceSearchingRemote && replaceQuery && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {replaceQuery && replaceResults.length > 0 && (
            <ul className="mt-1.5 max-h-48 divide-y divide-border/60 overflow-auto rounded-md border border-border/60 bg-popover">
              {replaceResults.map((food) => (
                <li key={food.id ?? food.name}>
                  <button
                    type="button"
                    onClick={() => onReplace(food)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm">{food.name}</span>
                        {food.source && (
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-[9px] font-medium uppercase tracking-wide"
                          >
                            {food.source}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {Math.round(food.calories)} kcal · P
                        {food.protein.toFixed(1)} · C{food.carbs.toFixed(1)} · F
                        {food.fat.toFixed(1)}
                        <span className="ml-1 text-muted-foreground/60">
                          / 100g
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {replaceQuery && replaceResults.length === 0 && (
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
              {replaceSearchingRemote ? "Searching…" : "No matches."}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-2 py-2 sm:px-3">
          <button
            type="button"
            {...handleProps}
            className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing sm:h-7"
            aria-label={`Drag to reorder ${ing.foodName}`}
          >
            <GripVertical className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
          <div className="min-w-0 flex-1">
            {/* Tooltip surfaces the full name on hover (desktop) and
             *  on tap-and-hold (touch) - Radix' delayDuration applies
             *  to mouse only, so quick mouse-overs don't fire. The
             *  truncate + min-w-0 chain keeps the row from blowing
             *  past the dialog width on long OFF product names like
             *  "Mozzarella (Galbani Mozzarella Light drained)".
             *  asChild lets the truncated div BE the trigger so
             *  there's no nested-button accessibility weirdness. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-default truncate text-sm font-medium">
                  {ing.foodName}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                className="max-w-xs break-words text-xs"
              >
                {ing.foodName}
              </TooltipContent>
            </Tooltip>
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {Math.round(m.calories)} kcal · P{m.protein.toFixed(1)} · C
              {m.carbs.toFixed(1)} · F{m.fat.toFixed(1)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              inputMode="numeric"
              value={ing.portionGrams}
              min={PORTION_MIN}
              max={PORTION_MAX}
              onChange={(e) => onPortionChange(e.target.value)}
              className="h-8 w-16 text-right font-mono tabular-nums"
              aria-label={`Portion in grams for ${ing.foodName}`}
            />
            <span className="text-[10px] text-muted-foreground">g</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground sm:h-8 sm:w-8"
            onClick={onStartReplace}
            aria-label={`Replace ${ing.foodName}`}
            title="Replace with another food"
          >
            <Replace className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
            onClick={onRemove}
            aria-label={`Remove ${ing.foodName}`}
          >
            <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </Button>
        </div>
      )}
      {/* idx is consumed by ARIA / future telemetry - silenced to
          keep noUnusedParameters happy without removing the slot. */}
      {void idx}
    </li>
  );
}
