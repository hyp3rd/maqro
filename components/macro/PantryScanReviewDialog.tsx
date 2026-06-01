"use client";

import type { ResolvedPantryScan } from "@/app/api/identify-pantry/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Sparkles } from "lucide-react";

/** A reviewed pantry-scan row ready to commit. */
export type PantryDraftItem = { name: string; quantity: number; unit: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** AI-resolved scan. `null` while the parent has nothing to show. */
  result: ResolvedPantryScan | null;
  /** Commit the checked + edited rows. The parent owns the actual
   *  `addPantryItem` writes so the IDB path stays single (mirrors how
   *  MealPhotoReviewDialog delegates the save). */
  onConfirm: (items: PantryDraftItem[]) => void;
};

type Row = {
  include: boolean;
  name: string;
  quantity: string;
  unit: string;
  confidence: "high" | "medium" | "low";
};

/** Review step after a pantry photo scan. Every AI-identified item is
 *  shown as an editable, individually-toggleable row — the scan is a
 *  suggestion, not a commitment. Low-confidence rows start unchecked
 *  so the user opts INTO the uncertain ones rather than having to hunt
 *  for and remove them. Nothing is written until "Add" is pressed.
 *
 *  Mounts its rows from `result` via the open-transition (set-state-
 *  during-render on `result` identity), the same pattern the other
 *  review dialogs use to seed local edit state from a prop without a
 *  setState-in-effect. */
export function PantryScanReviewDialog({
  open,
  onOpenChange,
  result,
  onConfirm,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  // Re-seed rows whenever a new scan result arrives. Compared by
  // identity: a fresh fetch produces a new object, which is the
  // signal to rebuild the editable rows.
  const [seededFrom, setSeededFrom] = useState<ResolvedPantryScan | null>(null);
  if (result !== seededFrom) {
    setSeededFrom(result);
    setRows(
      (result?.items ?? []).map((i) => ({
        // Pre-check confident rows; leave low-confidence opt-in.
        include: i.confidence !== "low",
        name: i.name,
        quantity: String(i.quantity),
        unit: i.unit,
        confidence: i.confidence,
      })),
    );
  }

  function patch(index: number, next: Partial<Row>) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...next } : r)),
    );
  }

  const selectedCount = rows.filter((r) => r.include).length;

  function handleConfirm() {
    const items: PantryDraftItem[] = [];
    for (const r of rows) {
      if (!r.include) continue;
      const name = r.name.trim();
      if (!name) continue;
      const quantity = Number(r.quantity);
      items.push({
        name,
        quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 1,
        unit: r.unit.trim() || "item",
      });
    }
    onConfirm(items);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Review scanned items
          </DialogTitle>
          <DialogDescription>
            Uncheck anything you don&apos;t want, fix counts, then add to your
            pantry. Low-confidence guesses start unchecked.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-1.5 overflow-auto py-1">
          {rows.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              Nothing to review.
            </p>
          ) : (
            rows.map((row, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
              >
                <Checkbox
                  checked={row.include}
                  onCheckedChange={(v) => patch(index, { include: v === true })}
                  aria-label={`Include ${row.name}`}
                />
                <Input
                  value={row.name}
                  onChange={(e) => patch(index, { name: e.target.value })}
                  className="h-8 min-w-0 flex-1 text-sm"
                  aria-label="Item name"
                />
                <Input
                  value={row.quantity}
                  onChange={(e) =>
                    patch(index, {
                      quantity: e.target.value.replace(/[^\d.]/g, ""),
                    })
                  }
                  inputMode="decimal"
                  className="h-8 w-14 text-center text-sm"
                  aria-label="Quantity"
                />
                <Input
                  value={row.unit}
                  onChange={(e) => patch(index, { unit: e.target.value })}
                  className="h-8 w-24 text-sm"
                  aria-label="Unit"
                />
                {row.confidence === "low" && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px] font-normal"
                  >
                    guess
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={selectedCount === 0}
          >
            {selectedCount > 0 ? `Add ${selectedCount}` : "Add"}
            {selectedCount === 1 ? " item" : " items"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
