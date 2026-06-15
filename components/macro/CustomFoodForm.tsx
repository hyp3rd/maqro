"use client";

import type { Food, FoodKind } from "@/components/macro/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCustomFood,
  customToFood,
  upsertCustomFood,
  type CustomFood,
} from "@/lib/db";
import { FOOD_KIND_LABEL } from "@/lib/diet";
import { bumpPending } from "@/lib/sync-status";
import { useState } from "react";

type DraftFood = {
  name: string;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  brand: string;
  /** Empty string = not classified yet. We don't pre-default a kind because
   * "plant" vs "land-meat" is a meaningful pick the user should make
   * deliberately, and unclassified custom foods become omnivore-only
   * (handled by the diet filter), so a missing value still does something
   * sensible. */
  dietKind: FoodKind | "";
  /** Optional macro-breakdown. Empty string = unknown; the saver omits
   *  any field the user left blank so the persisted row's value stays
   *  `undefined` (which the display layer treats as "no data" rather
   *  than "zero"). All seven mirror the `MacroBreakdown` mixin. */
  sugars: number | "";
  addedSugars: number | "";
  fiber: number | "";
  saturatedFat: number | "";
  transFat: number | "";
  monoFat: number | "";
  polyFat: number | "";
};

const EMPTY_DRAFT: DraftFood = {
  name: "",
  protein: 0,
  carbs: 0,
  fat: 0,
  calories: 0,
  brand: "",
  dietKind: "",
  sugars: "",
  addedSugars: "",
  fiber: "",
  saturatedFat: "",
  transFat: "",
  monoFat: "",
  polyFat: "",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional initial values — used when "saving" an OFF result. */
  initial?: Partial<DraftFood>;
  /** When present, the dialog is in edit mode — pre-fills from this row
   * and saves via upsert (preserving id + createdAt). */
  editing?: CustomFood;
  onSaved: (food: Food) => void;
};

function toDraft(
  editing?: CustomFood,
  initial?: Partial<DraftFood>,
): DraftFood {
  if (editing) {
    return {
      name: editing.name,
      protein: editing.protein,
      carbs: editing.carbs,
      fat: editing.fat,
      calories: editing.calories,
      brand: editing.brand ?? "",
      dietKind: editing.dietKind ?? "",
      sugars: editing.sugars ?? "",
      addedSugars: editing.addedSugars ?? "",
      fiber: editing.fiber ?? "",
      saturatedFat: editing.saturatedFat ?? "",
      transFat: editing.transFat ?? "",
      monoFat: editing.monoFat ?? "",
      polyFat: editing.polyFat ?? "",
    };
  }
  return { ...EMPTY_DRAFT, ...initial };
}

/** Modal form for adding or editing a custom food. All macros are per 100g.
 * Calories auto-derive from macros (4/4/9) unless the user types an explicit
 * value. The "Kind" field classifies the food for the diet filter — leave
 * blank and the food becomes omnivore-only.
 *
 * The Dialog wrapper stays mounted while the dialog is closed; the inner
 * `<Form>` re-mounts via `key` whenever the editing target changes, which
 * lets `useState` initializers seed the draft from props without an effect. */
export function CustomFoodForm({
  open,
  onOpenChange,
  initial,
  editing,
  onSaved,
}: Props) {
  // `key` swaps on (open transition × target) so the form starts fresh
  // each time the dialog opens for a new food.
  const formKey = `${open}-${editing?.id ?? "new"}`;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        <Form
          key={formKey}
          initial={initial}
          editing={editing}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function Form({
  initial,
  editing,
  onSaved,
  onClose,
}: {
  initial?: Partial<DraftFood>;
  editing?: CustomFood;
  onSaved: (food: Food) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DraftFood>(() =>
    toDraft(editing, initial),
  );
  const [caloriesEdited, setCaloriesEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setNumeric(field: keyof DraftFood, raw: string) {
    const v = Number.parseFloat(raw);
    const next = { ...draft, [field]: Number.isNaN(v) ? 0 : v };
    if (
      !caloriesEdited &&
      (field === "protein" || field === "carbs" || field === "fat")
    ) {
      next.calories = Math.round(
        next.protein * 4 + next.carbs * 4 + next.fat * 9,
      );
    }
    setDraft(next);
  }

  /** Like setNumeric but distinguishes an empty input from `0` —
   *  required for the optional sub-macro fields so an unfilled "Sugars"
   *  saves as undefined (unknown) rather than `0` (which the display
   *  layer would render as a real zero). */
  function setOptionalNumeric(
    field:
      | "sugars"
      | "addedSugars"
      | "fiber"
      | "saturatedFat"
      | "transFat"
      | "monoFat"
      | "polyFat",
    raw: string,
  ) {
    if (raw.trim() === "") {
      setDraft({ ...draft, [field]: "" });
      return;
    }
    const v = Number.parseFloat(raw);
    setDraft({ ...draft, [field]: Number.isNaN(v) ? "" : v });
  }

  async function save() {
    setError(null);
    if (!draft.name.trim()) {
      setError("Name is required");
      return;
    }
    // Validate the optional macro-breakdown against the main macros.
    // The invariants: sugars ≤ carbs (sugars are a subset of total
    // carbs), addedSugars ≤ total sugars, and the four fat subtypes
    // sum to no more than total fat. Fiber is intentionally NOT
    // checked against carbs — EU labels exclude fiber from the carbs
    // total, so fiber > carbs is correct for many real products. The
    // "≤" margin tolerates small rounding errors (0.5 g).
    const breakdownError = validateBreakdown(draft);
    if (breakdownError) {
      setError(breakdownError);
      return;
    }
    setSaving(true);
    try {
      // Helper: empty string → undefined so the persisted row's
      // sub-macro stays unset, which the display layer reads as
      // "unknown" rather than "0g".
      const optNum = (v: number | "") => (v === "" ? undefined : v);
      const payload = {
        name: draft.name.trim(),
        protein: draft.protein,
        carbs: draft.carbs,
        fat: draft.fat,
        calories: draft.calories,
        brand: draft.brand.trim() || undefined,
        dietKind: draft.dietKind === "" ? undefined : draft.dietKind,
        sugars: optNum(draft.sugars),
        addedSugars: optNum(draft.addedSugars),
        fiber: optNum(draft.fiber),
        saturatedFat: optNum(draft.saturatedFat),
        transFat: optNum(draft.transFat),
        monoFat: optNum(draft.monoFat),
        polyFat: optNum(draft.polyFat),
      };
      let savedFood: CustomFood;
      if (editing) {
        savedFood = { ...editing, ...payload };
        await upsertCustomFood(savedFood);
      } else {
        const id = await addCustomFood(payload);
        savedFood = { id, createdAt: Date.now(), ...payload };
      }
      bumpPending();
      onSaved(customToFood(savedFood));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (saving) return;
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit custom food" : "Add custom food"}
        </DialogTitle>
        <DialogDescription>
          Macros are stored per 100g. Calories auto-calculate from macros unless
          you override.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-4 py-4">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="cf-name">Name</Label>
          <Input
            id="cf-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label htmlFor="cf-brand">Brand (optional)</Label>
          <Input
            id="cf-brand"
            value={draft.brand}
            onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label htmlFor="cf-kind">Kind</Label>
          <Select
            value={draft.dietKind}
            onValueChange={(v) =>
              setDraft({ ...draft, dietKind: v as FoodKind })
            }
          >
            <SelectTrigger id="cf-kind">
              <SelectValue placeholder="Pick a kind (omnivore-only if blank)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plant">{FOOD_KIND_LABEL.plant}</SelectItem>
              <SelectItem value="seafood">{FOOD_KIND_LABEL.seafood}</SelectItem>
              <SelectItem value="land-meat">
                {FOOD_KIND_LABEL["land-meat"]}
              </SelectItem>
              <SelectItem value="egg">{FOOD_KIND_LABEL.egg}</SelectItem>
              <SelectItem value="dairy">{FOOD_KIND_LABEL.dairy}</SelectItem>
              <SelectItem value="honey">{FOOD_KIND_LABEL.honey}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Drives the diet filter when Auto-fill builds a plan. Leave blank and
            the food only shows up under the Omnivore preference.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-protein">Protein / 100g</Label>
          <Input
            id="cf-protein"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={draft.protein}
            onChange={(e) => setNumeric("protein", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-carbs">Carbs / 100g</Label>
          <Input
            id="cf-carbs"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={draft.carbs}
            onChange={(e) => setNumeric("carbs", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-fat">Fat / 100g</Label>
          <Input
            id="cf-fat"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={draft.fat}
            onChange={(e) => setNumeric("fat", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cf-calories">Calories / 100g</Label>
          <Input
            id="cf-calories"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={draft.calories}
            onChange={(e) => {
              setCaloriesEdited(true);
              setNumeric("calories", e.target.value);
            }}
          />
        </div>

        {/* Optional macro-breakdown. Native <details> keeps this
            collapsed until the user opens it, so the form's main
            face stays focused on the four core macros. Empty inputs
            map to undefined on save (not 0) so the display layer
            distinguishes "unknown" from a real zero. */}
        <details className="col-span-2 group">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            More macros (optional) — sugars, fiber, fat subtypes
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <OptionalNumberField
              id="cf-sugars"
              label="Sugars / 100g"
              value={draft.sugars}
              onChange={(v) => setOptionalNumeric("sugars", v)}
            />
            <OptionalNumberField
              id="cf-added-sugars"
              label="Added sugars / 100g"
              value={draft.addedSugars}
              onChange={(v) => setOptionalNumeric("addedSugars", v)}
            />
            <OptionalNumberField
              id="cf-fiber"
              label="Fiber / 100g"
              value={draft.fiber}
              onChange={(v) => setOptionalNumeric("fiber", v)}
            />
            <OptionalNumberField
              id="cf-sat-fat"
              label="Saturated fat / 100g"
              value={draft.saturatedFat}
              onChange={(v) => setOptionalNumeric("saturatedFat", v)}
            />
            <OptionalNumberField
              id="cf-trans-fat"
              label="Trans fat / 100g"
              value={draft.transFat}
              onChange={(v) => setOptionalNumeric("transFat", v)}
            />
            <OptionalNumberField
              id="cf-mono-fat"
              label="Mono-unsat. fat / 100g"
              value={draft.monoFat}
              onChange={(v) => setOptionalNumeric("monoFat", v)}
            />
            <OptionalNumberField
              id="cf-poly-fat"
              label="Poly-unsat. fat / 100g"
              value={draft.polyFat}
              onChange={(v) => setOptionalNumeric("polyFat", v)}
            />
          </div>
        </details>
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving}
        >
          {saving ? "Saving..." : editing ? "Save changes" : "Save food"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function OptionalNumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | "";
  onChange: (raw: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
      />
    </div>
  );
}

/** Per-100g sub-macro invariants the form enforces on save:
 *
 *    sugars          ≤  carbs    (sugars are a subset of total carbs)
 *    addedSugars     ≤  sugars   (added is a subset of total sugars)
 *    sat+trans+mono+poly ≤ fat   (the four subtypes sum to ≤ total fat)
 *
 *  **Fiber is intentionally NOT enforced against carbs.** EU nutrition
 *  labels report "Carbohydrate" excluding fiber, so high-fiber foods
 *  (bran cereals, psyllium, etc.) legitimately show fiber > carbs.
 *  US labels include fiber in total carbs, so for those products
 *  fiber ≤ carbs would hold — but we can't tell which convention a
 *  given label uses, so we don't gate on it.
 *
 *  Empty (= unknown) sub-macros are skipped. A 0.5 g margin absorbs
 *  label-rounding error — packaged-food labels routinely round each
 *  line to the nearest gram so the parts can legitimately overshoot
 *  the whole by a small fraction.
 *
 *  Exported so unit tests can pin the boundary conditions. */
export function validateBreakdown(draft: {
  carbs: number;
  fat: number;
  sugars: number | "";
  addedSugars: number | "";
  fiber: number | "";
  saturatedFat: number | "";
  transFat: number | "";
  monoFat: number | "";
  polyFat: number | "";
}): string | null {
  const TOLERANCE = 0.5;
  const num = (v: number | "") => (v === "" ? 0 : v);
  const sugars = num(draft.sugars);
  const fiber = num(draft.fiber);
  const added = num(draft.addedSugars);
  const sat = num(draft.saturatedFat);
  const trans = num(draft.transFat);
  const mono = num(draft.monoFat);
  const poly = num(draft.polyFat);

  // Sugars are a subset of total carbs by definition — enforce the cap.
  // Fiber is NOT enforced against carbs: EU nutrition labels report
  // "Carbohydrate" excluding fiber, so for many real products fiber >
  // carbs is correct. US labels include fiber in total carbs, so for
  // those products fiber ≤ carbs. We can't tell which labeling
  // convention a given product uses, so we don't gate on it — the
  // sugars ≤ carbs check still catches the obviously-wrong cases
  // (most data-entry typos collapse there).
  if (sugars > draft.carbs + TOLERANCE) {
    return `Sugars (${sugars} g) can't exceed total carbs (${draft.carbs} g).`;
  }
  if (added > sugars + TOLERANCE) {
    // Two flavors of this error so the message is specific.
    if (draft.sugars === "") {
      return `Added sugars (${added} g) requires total sugars to be set first.`;
    }
    return `Added sugars (${added} g) can't exceed total sugars (${sugars} g).`;
  }
  // Silence the unused-binding lint now that fiber doesn't participate
  // in a check (kept in the destructuring above for symmetry + future
  // extension).
  void fiber;
  const fatSum = sat + trans + mono + poly;
  if (fatSum > draft.fat + TOLERANCE) {
    return `Saturated + trans + mono- + poly-unsat (${fatSum} g) can't exceed total fat (${draft.fat} g).`;
  }
  return null;
}
