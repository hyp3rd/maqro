"use client";

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
import { useFoodSearch } from "@/hooks/use-food-search";
import { useMemo, useRef, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import type { Food, FoodItem } from "./types";

/** Edit a meal template's *contents* — not just its name. The user
 *  can rename, add foods (via the same search the meal planner uses
 *  for fresh entries), adjust per-row portions, and remove rows.
 *
 *  Mounted by TemplatesView and seeded with the row's current name +
 *  foods. On Save, the caller persists via `upsertMealTemplate`. The
 *  dialog stays presentational — IDB writes go through the consumer.
 *
 *  The food shape stored in a template is `FoodItem` (post-portion
 *  macros + a snapshot of per-100g originals). Adding a search result
 *  goes through the same per-100g × portion scaling the meal planner
 *  does so a 50 g portion of "Oats" yields the right macros. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  initialFoods: FoodItem[];
  onSave: (next: { name: string; foods: FoodItem[] }) => void;
};

const DEFAULT_PORTION = 100;

export function TemplateEditDialog({
  open,
  onOpenChange,
  initialName,
  initialFoods,
  onSave,
}: Props) {
  // Inner component re-mounts via `key` whenever the dialog opens for a
  // different template, so `useState` initializers seed from props
  // without needing an effect. Matches CustomFoodForm's pattern.
  const key = `${open}-${initialName}-${initialFoods.length}`;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && (
          <EditorBody
            key={key}
            initialName={initialName}
            initialFoods={initialFoods}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorBody({
  initialName,
  initialFoods,
  onSave,
  onClose,
}: {
  initialName: string;
  initialFoods: FoodItem[];
  onSave: (next: { name: string; foods: FoodItem[] }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [foods, setFoods] = useState<FoodItem[]>(initialFoods);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { results, isSearchingRemote } = useFoodSearch(query);
  // Monotonic per-template id counter so each newly added food row
  // gets a unique numeric `id`. Starts past the highest existing id
  // so we never collide with rows already in the template. A plain
  // counter ref is preferable to `Date.now()` here — react-hooks's
  // purity rule (correctly) flags time-based ids inside renderable
  // functions, and the id only needs to be unique within this
  // template's foods array, not globally.
  const nextIdRef = useRef(
    initialFoods.reduce((max, f) => Math.max(max, f.id), 0) + 1,
  );

  const totals = useMemo(
    () =>
      foods.reduce(
        (acc, f) => ({
          protein: acc.protein + f.protein,
          carbs: acc.carbs + f.carbs,
          fat: acc.fat + f.fat,
          calories: acc.calories + f.calories,
        }),
        { protein: 0, carbs: 0, fat: 0, calories: 0 },
      ),
    [foods],
  );

  function addFromSearch(source: Food) {
    const portion = DEFAULT_PORTION;
    const ratio = portion / 100;
    const id = nextIdRef.current++;
    const next: FoodItem = {
      id,
      name: source.name,
      protein: Number.parseFloat((source.protein * ratio).toFixed(1)),
      carbs: Number.parseFloat((source.carbs * ratio).toFixed(1)),
      fat: Number.parseFloat((source.fat * ratio).toFixed(1)),
      calories: Math.round(source.calories * ratio),
      portionSize: portion,
      // Capture per-100g snapshot so portion edits below can scale
      // correctly without re-resolving the source food.
      originalValues: {
        proteinPer100g: source.protein,
        carbsPer100g: source.carbs,
        fatPer100g: source.fat,
        caloriesPer100g: source.calories,
      },
    };
    setFoods([...foods, next]);
    setQuery("");
  }

  function changePortion(id: number, raw: string) {
    const portion = Math.max(1, Math.min(2000, Number.parseInt(raw, 10) || 0));
    setFoods(
      foods.map((f) => {
        if (f.id !== id) return f;
        const orig = f.originalValues;
        // Without an originals snapshot (legacy template rows), fall
        // back to scaling from the row's current value at its current
        // portionSize — same logic the editor uses elsewhere.
        const p100 = orig
          ? orig.proteinPer100g
          : (f.protein * 100) / (f.portionSize || 100);
        const c100 = orig
          ? orig.carbsPer100g
          : (f.carbs * 100) / (f.portionSize || 100);
        const fat100 = orig
          ? orig.fatPer100g
          : (f.fat * 100) / (f.portionSize || 100);
        const cal100 = orig
          ? orig.caloriesPer100g
          : (f.calories * 100) / (f.portionSize || 100);
        const ratio = portion / 100;
        return {
          ...f,
          portionSize: portion,
          protein: Number.parseFloat((p100 * ratio).toFixed(1)),
          carbs: Number.parseFloat((c100 * ratio).toFixed(1)),
          fat: Number.parseFloat((fat100 * ratio).toFixed(1)),
          calories: Math.round(cal100 * ratio),
        };
      }),
    );
  }

  function removeAt(id: number) {
    setFoods(foods.filter((f) => f.id !== id));
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (foods.length === 0) {
      setError("Add at least one food, or cancel to keep the template as-is.");
      return;
    }
    setError(null);
    onSave({ name: trimmed, foods });
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit template</DialogTitle>
        <DialogDescription>
          Add or remove foods, adjust portions, rename. Saving overwrites the
          template — copies of the template you&apos;ve already applied to past
          meals are untouched.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label
            htmlFor="te-name"
            className="text-xs font-medium text-muted-foreground"
          >
            Name
          </Label>
          <Input
            id="te-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Foods ({foods.length})
          </p>
          {foods.length === 0 ? (
            <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
              No foods yet. Use the search below to add some.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card">
              {foods.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {Math.round(f.calories)} kcal · P{f.protein} · C{f.carbs}{" "}
                      · F{f.fat}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={2000}
                      value={f.portionSize}
                      onChange={(e) => changePortion(f.id, e.target.value)}
                      className="h-7 w-16 text-right font-mono tabular-nums"
                    />
                    <span className="text-[10px] text-muted-foreground">g</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
                    onClick={() => removeAt(f.id)}
                    aria-label={`Remove ${f.name}`}
                  >
                    <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {foods.length > 0 && (
          <div className="rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
            Total: {Math.round(totals.calories)} kcal · P
            {Math.round(totals.protein)} · C{Math.round(totals.carbs)} · F
            {Math.round(totals.fat)}
          </div>
        )}

        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <Label
            htmlFor="te-add"
            className="text-xs font-medium text-muted-foreground"
          >
            Add food
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="te-add"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search built-in, your foods, and Open Food Facts"
              className="pl-9"
            />
          </div>
          {query.trim() && (
            <div className="max-h-44 overflow-auto rounded-md border border-border/60 bg-card">
              {results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  {isSearchingRemote ? "Searching…" : "No matches."}
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {results.map((r) => (
                    <li
                      key={r.id ?? r.name}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {r.name}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {r.calories} kcal/100g · P{r.protein} · C{r.carbs} · F
                          {r.fat}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 sm:h-8 sm:w-8"
                        onClick={() => addFromSearch(r)}
                        aria-label={`Add ${r.name} (${DEFAULT_PORTION} g)`}
                      >
                        <Plus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="text-xs text-red-600"
          >
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSave}
        >
          Save changes
        </Button>
      </DialogFooter>
    </>
  );
}
