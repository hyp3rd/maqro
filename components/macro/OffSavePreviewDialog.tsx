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
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Food, MacroBreakdown } from "./types";

/** Preview dialog shown before saving an Open Food Facts result to My
 *  Foods. The OFF *search* endpoint returns only the basic per-100g
 *  macros (P / C / F / kcal). The OFF *barcode* endpoint returns the
 *  full product, including the macros breakdown (sugars, fiber, fat
 *  subtypes). This dialog pulls the barcode endpoint on open to
 *  enrich the food before the user commits.
 *
 *  Behavior:
 *  - Open with the search-result `Food`. The dialog detects the
 *    barcode in `id` (format `off:<code>`) and fires
 *    `/api/off-barcode/<code>`.
 *  - While loading, the breakdown rows render as skeletons.
 *  - On success, the enriched Food replaces the seed and the rows
 *    populate with real numbers.
 *  - On failure (offline, OFF down, unknown barcode), the dialog
 *    keeps the basic macros and notes that the breakdown couldn't be
 *    fetched — the user can still save with the limited data. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The OFF search result the user clicked Save on. Null = dialog
   *  is closed. */
  food: Food | null;
  /** Persist the (possibly enriched) food. The parent handles the
   *  actual `addCustomFood` call so this dialog stays presentational. */
  onSave: (food: Food) => Promise<void> | void;
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

/** Extract the OFF barcode from a `Food.id` of shape `off:<code>`.
 *  Returns null when the id doesn't match (custom foods, builtin, or
 *  malformed) — the dialog then skips the enrich step and shows the
 *  basic search result as-is. */
function extractBarcode(food: Food): string | null {
  if (food.source !== "off" || !food.id) return null;
  const match = /^off:(.+)$/.exec(food.id);
  return match?.[1]?.trim() || null;
}

export function OffSavePreviewDialog({
  open,
  onOpenChange,
  food,
  onSave,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && food && (
          <PreviewBody
            initialFood={food}
            onSave={async (f) => {
              await onSave(f);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  initialFood,
  onSave,
  onCancel,
}: {
  initialFood: Food;
  onSave: (food: Food) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [food, setFood] = useState<Food>(initialFood);
  // Initial loading state derived from whether we have a barcode to
  // fetch in the first place. Calling setLoading(false) inside the
  // effect body for the no-barcode case would trip
  // react-hooks/set-state-in-effect; deriving it here keeps the
  // effect's only setState in async callbacks.
  const [loading, setLoading] = useState<boolean>(
    () => extractBarcode(initialFood) !== null,
  );
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch the full product data on open. The barcode lookup is the
  // only path to the breakdown fields — search results have just the
  // basic macros. If the lookup fails the user can still save the
  // basic data, so we never block the Save button on a failed enrich.
  useEffect(() => {
    let cancelled = false;
    const barcode = extractBarcode(initialFood);
    if (!barcode) return;
    fetch(`/api/off-barcode/${encodeURIComponent(barcode)}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { food?: Food };
        if (cancelled) return;
        if (data.food) {
          // Merge: keep the search-result name in case the barcode
          // returned a less-friendly variant; replace macros and pull
          // in the breakdown.
          setFood({ ...data.food, name: initialFood.name });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setEnrichError(
          err instanceof Error
            ? err.message
            : "Couldn't fetch the full breakdown.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialFood]);

  const breakdownRows = (
    Object.keys(BREAKDOWN_LABELS) as Array<keyof MacroBreakdown>
  )
    .map((k) => [k, food[k]] as const)
    .filter(
      (entry): entry is readonly [keyof MacroBreakdown, number] =>
        typeof entry[1] === "number",
    );

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(food);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
      setSaving(false);
    }
    // No need to clear saving on success — dialog closes.
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate">{food.name}</DialogTitle>
        <DialogDescription>
          {food.brand ? `${food.brand} · ` : ""}From Open Food Facts. Review
          before saving to My Foods.
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

        <section className="rounded-md border border-border/60 bg-card px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Breakdown (per 100 g)
            </p>
            {loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          {loading ? (
            <div className="space-y-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-3 w-full animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          ) : breakdownRows.length > 0 ? (
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
          ) : (
            <p className="text-xs text-muted-foreground">
              {enrichError
                ? `Couldn't fetch full breakdown (${enrichError}). The basic macros above are still saved.`
                : "No breakdown data on this product. You can add sugars / fiber / fat subtypes manually after saving."}
            </p>
          )}
        </section>

        {saveError && (
          <p
            role="alert"
            className="text-xs text-red-600 dark:text-red-400"
          >
            {saveError}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? "Saving…" : "Save to My Foods"}
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
