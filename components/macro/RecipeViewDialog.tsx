"use client";

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
import { useState } from "react";
import { ExternalLink, Link2, Pencil } from "lucide-react";
import Link from "next/link";
import type { Recipe } from "./types";

/** Read-only details view for a saved recipe. The Recipes list only
 *  exposes Edit + Share + Delete actions; without this dialog the
 *  only way to inspect a recipe was to open the edit form, which is
 *  visually busy and easy to mis-fire (a stray keystroke saves a
 *  change). The view dialog mirrors the layout of the public
 *  `/r/<slug>` page so power-users get the same scannable shape
 *  in-app and on a shared link. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: Recipe | null;
  /** Switch to Edit mode for this recipe. The parent reuses its
   *  existing edit-dialog plumbing; this prop just lets the View
   *  dialog hand control over without the user re-finding the row. */
  onEdit?: (recipe: Recipe) => void;
};

export function RecipeViewDialog({
  open,
  onOpenChange,
  recipe,
  onEdit,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && recipe && (
          <ViewBody
            recipe={recipe}
            onEdit={onEdit}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewBody({
  recipe,
  onEdit,
  onClose,
}: {
  recipe: Recipe;
  onEdit?: (recipe: Recipe) => void;
  onClose: () => void;
}) {
  // View-time scaling. The "scale to N servings" control multiplies
  // portionGrams (and therefore macros) by (target/recipe.servings)
  // for display ONLY — the saved recipe stays canonical, sized for
  // its original `servings` count. Re-opening the dialog resets to
  // 1×. If the recipe didn't declare a servings count, scaling is
  // hidden because there's no denominator to scale against.
  const baseServings = recipe.servings ?? 0;
  const [scaledServings, setScaledServings] = useState<number>(baseServings);
  const scale = baseServings > 0 ? scaledServings / baseServings : 1;
  const isScaled = scale !== 1 && Number.isFinite(scale) && scale > 0;

  const totals = recipe.ingredients.reduce(
    (acc, ing) => {
      // Apply scale at the per-ingredient level so the displayed
      // portion sizes and the totals stay numerically consistent —
      // rounding the totals after a global multiply would diverge
      // from "sum of rounded per-ingredient values" by a noticeable
      // amount on small recipes.
      const ratio = (ing.portionGrams * scale) / 100;
      return {
        protein: acc.protein + ing.macrosPer100g.protein * ratio,
        carbs: acc.carbs + ing.macrosPer100g.carbs * ratio,
        fat: acc.fat + ing.macrosPer100g.fat * ratio,
        calories: acc.calories + ing.macrosPer100g.calories * ratio,
      };
    },
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
  const totalGrams = recipe.ingredients.reduce(
    (a, ing) => a + ing.portionGrams * scale,
    0,
  );

  return (
    <>
      <DialogHeader>
        {/* `pr-8` reserves space for the Dialog primitive's
         *  absolutely-positioned close button so a long title can
         *  wrap to a second line instead of running underneath. The
         *  cuisine badge moved down to the meta row — keeping it
         *  inline with the title caused collisions with the X on
         *  longer combinations ("Contemporary Health" + a long
         *  recipe name).
         *
         *  The badge + description sit in a flex row sibling rather
         *  than inside DialogDescription itself: Radix renders the
         *  description as a `<p>`, and Badge renders a `<div>`, so
         *  nesting them would produce an invalid `<div>` inside `<p>`
         *  (caught at hydration time). */}
        <DialogTitle className="pr-8 leading-tight">{recipe.name}</DialogTitle>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {recipe.cuisine && (
            <Badge
              variant="secondary"
              className="text-[10px] font-normal"
            >
              {recipe.cuisine}
            </Badge>
          )}
          {recipe.servings != null && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal"
            >
              {recipe.servings} {recipe.servings === 1 ? "serving" : "servings"}
            </Badge>
          )}
          {recipe.prepTimeMinutes != null && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal"
            >
              {formatPrepMinutes(recipe.prepTimeMinutes)}
            </Badge>
          )}
          <DialogDescription>
            {recipe.ingredients.length} ingredient
            {recipe.ingredients.length === 1 ? "" : "s"}
            {totalGrams > 0 && ` · ${Math.round(totalGrams)} g total`}
            {recipe.shareSlug && " · shared"}
          </DialogDescription>
        </div>
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Link2 className="h-3 w-3" />
            <span className="truncate">{prettifyHost(recipe.sourceUrl)}</span>
          </a>
        )}
      </DialogHeader>

      <div className="space-y-3 py-2">
        {baseServings > 0 && (
          // The scaler is opt-in visible: hidden when the recipe
          // didn't declare a servings count (no denominator) so users
          // never see a misleading control on legacy recipes.
          <section className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <label
                htmlFor="recipe-scale"
                className="font-medium uppercase tracking-wider text-muted-foreground"
              >
                Scale to
              </label>
              <input
                id="recipe-scale"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                value={scaledServings}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n) && n > 0 && n <= 100) {
                    setScaledServings(n);
                  } else if (e.target.value === "") {
                    setScaledServings(baseServings);
                  }
                }}
                className="w-16 rounded-md border border-border/60 bg-background px-2 py-0.5 text-center text-sm tabular-nums"
              />
              <span className="text-muted-foreground">
                {scaledServings === 1 ? "serving" : "servings"}
              </span>
            </div>
            {isScaled && (
              <button
                type="button"
                onClick={() => setScaledServings(baseServings)}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Reset to recipe servings"
              >
                Reset (×1)
              </button>
            )}
          </section>
        )}
        <section className="rounded-md border border-border/60 bg-card px-3 py-2.5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Macros ({isScaled ? `scaled ×${scale.toFixed(2)}` : "full recipe"})
          </p>
          <dl className="grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-sm tabular-nums">
            <MacroCell
              label="kcal"
              value={Math.round(totals.calories)}
            />
            <MacroCell
              label="P"
              value={`${totals.protein.toFixed(1)}g`}
              cssVar="--macro-protein"
            />
            <MacroCell
              label="C"
              value={`${totals.carbs.toFixed(1)}g`}
              cssVar="--macro-carbs"
            />
            <MacroCell
              label="F"
              value={`${totals.fat.toFixed(1)}g`}
              cssVar="--macro-fat"
            />
          </dl>
        </section>

        <section>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Ingredients
          </p>
          {/* Two-line layout per ingredient: name on top, the
           *  portion + macro blob on its own row beneath. The
           *  earlier single-row flex layout pushed the macros next
           *  to the name, which meant their left edge floated based
           *  on name length (and content width — "P30.0" is wider
           *  than "P0.5"). Putting the macros on a dedicated row
           *  keeps every row's rhythm identical regardless of name
           *  length or macro magnitude. */}
          <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card">
            {recipe.ingredients.map((ing, idx) => {
              const scaledGrams = ing.portionGrams * scale;
              const ratio = scaledGrams / 100;
              return (
                <li
                  key={`${ing.foodName}-${idx}`}
                  className="px-3 py-2"
                >
                  <p className="text-sm leading-snug">{ing.foodName}</p>
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatGrams(scaledGrams)}g ·{" "}
                    {Math.round(ing.macrosPer100g.calories * ratio)} kcal · P
                    {(ing.macrosPer100g.protein * ratio).toFixed(1)} · C
                    {(ing.macrosPer100g.carbs * ratio).toFixed(1)} · F
                    {(ing.macrosPer100g.fat * ratio).toFixed(1)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {recipe.notes && (
          <section>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Notes
            </p>
            <p className="whitespace-pre-line rounded-md border border-border/60 bg-card px-3 py-2 text-sm leading-relaxed">
              {recipe.notes}
            </p>
          </section>
        )}

        {recipe.shareSlug && (
          <Link
            href={`/r/${recipe.shareSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Open public page
          </Link>
        )}
      </div>

      <DialogFooter>
        {onEdit && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onEdit(recipe);
              onClose();
            }}
            className="gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
        <Button
          type="button"
          onClick={onClose}
        >
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

/** Render a gram value at 0 dp when whole, 1 dp otherwise. Scaling
 *  produces fractional grams ("2.5 g salt" when halving a 5 g
 *  measure), and rounding to integer would print "3" — actively
 *  misleading on small portions. One decimal place balances
 *  precision and readability. */
function formatGrams(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Display the minute count in the badge as "Xh Ym" / "Xm" — same
 *  shape as the import-time formatter so a recipe imported from a
 *  URL looks identical to a manually-entered one. */
function formatPrepMinutes(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** Render the hostname for the source-URL hint instead of the full
 *  URL — keeps the dialog header from blowing out on long recipe
 *  permalinks. Defensive against a malformed URL just in case the
 *  validation upstream slipped. */
function prettifyHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

function MacroCell({
  label,
  value,
  cssVar,
}: {
  label: string;
  value: string | number;
  cssVar?: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className="text-sm font-semibold"
        style={cssVar ? { color: `hsl(var(${cssVar}))` } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
