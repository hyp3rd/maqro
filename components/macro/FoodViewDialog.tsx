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
import type { CustomFood } from "@/lib/db";
import { Pencil } from "lucide-react";
import type { MacroBreakdown } from "./types";

/** Read-only details view for a custom food. The My Foods list only
 *  exposes Edit + Delete actions; without this dialog the only way
 *  to inspect a food's full data (especially the macros breakdown —
 *  sugars, fiber, saturated fat, etc.) was to open the edit form,
 *  which puts every field into an editable input and risks
 *  accidental changes. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  food: CustomFood | null;
  /** Switch to Edit mode for this food. The parent owns the edit
   *  dialog; this prop just hands control over without forcing the
   *  user to re-find the row. */
  onEdit?: (food: CustomFood) => void;
};

const BREAKDOWN_LABELS: Record<keyof MacroBreakdown, string> = {
  sugars: "Sugars",
  addedSugars: "Added sugars",
  fiber: "Fiber",
  saturatedFat: "Saturated fat",
  transFat: "Trans fat",
  monoFat: "Mono-unsat. fat",
  polyFat: "Poly-unsat. fat",
};

const DIET_LABEL: Record<NonNullable<CustomFood["dietKind"]>, string> = {
  "land-meat": "Land meat",
  seafood: "Seafood",
  egg: "Egg",
  dairy: "Dairy",
  honey: "Honey",
  plant: "Plant",
};

export function FoodViewDialog({ open, onOpenChange, food, onEdit }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && food && (
          <ViewBody
            food={food}
            onEdit={onEdit}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewBody({
  food,
  onEdit,
  onClose,
}: {
  food: CustomFood;
  onEdit?: (food: CustomFood) => void;
  onClose: () => void;
}) {
  const breakdownRows = (
    Object.keys(BREAKDOWN_LABELS) as Array<keyof MacroBreakdown>
  )
    .map((k) => [k, food[k]] as const)
    .filter(
      (entry): entry is readonly [keyof MacroBreakdown, number] =>
        typeof entry[1] === "number",
    );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="truncate">{food.name}</span>
          {food.dietKind && (
            <Badge
              variant="secondary"
              className="shrink-0 text-[10px] font-normal"
            >
              {DIET_LABEL[food.dietKind]}
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription>
          {food.brand ? `${food.brand} · ` : ""}
          Per 100 g
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <section className="rounded-md border border-border/60 bg-card px-3 py-2.5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Macros (per 100 g)
          </p>
          <dl className="grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-sm tabular-nums">
            <MacroCell
              label="kcal"
              value={Math.round(food.calories)}
            />
            <MacroCell
              label="P"
              value={`${food.protein}g`}
              cssVar="--macro-protein"
            />
            <MacroCell
              label="C"
              value={`${food.carbs}g`}
              cssVar="--macro-carbs"
            />
            <MacroCell
              label="F"
              value={`${food.fat}g`}
              cssVar="--macro-fat"
            />
          </dl>
        </section>

        {breakdownRows.length > 0 ? (
          <section className="rounded-md border border-border/60 bg-card px-3 py-2.5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Breakdown (per 100 g)
            </p>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 font-mono text-xs tabular-nums sm:grid-cols-2">
              {breakdownRows.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline justify-between gap-2"
                >
                  <dt className="text-muted-foreground">
                    {BREAKDOWN_LABELS[key]}
                  </dt>
                  <dd className="text-foreground">{value} g</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-3 text-center text-xs text-muted-foreground">
            No macros breakdown saved. Edit the food to add sugars, fiber, or
            fat subtypes.
          </p>
        )}

        {(food.category || food.subCategory) && (
          <section className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Category:</span>{" "}
            {[food.category, food.subCategory].filter(Boolean).join(" · ")}
          </section>
        )}
      </div>

      <DialogFooter>
        {onEdit && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onEdit(food);
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
