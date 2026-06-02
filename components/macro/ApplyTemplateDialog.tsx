"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listMealTemplates } from "@/lib/db";
import type { MealTemplate } from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useState } from "react";
import { ChevronLeft, Eye } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the target meal slot (e.g. "Breakfast") — purely cosmetic. */
  targetMealName: string;
  onApply: (template: MealTemplate) => void;
  /** When provided, the header shows a back affordance returning to the
   *  previous step (the guided Log-meal method picker). Omitted when the
   *  dialog is opened standalone from a meal's menu. */
  onBack?: () => void;
};

function totalsOf(foods: MealTemplate["foods"]) {
  return foods.reduce(
    (acc, f) => ({
      protein: acc.protein + f.protein,
      carbs: acc.carbs + f.carbs,
      fat: acc.fat + f.fat,
      calories: acc.calories + f.calories,
    }),
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
}

export function ApplyTemplateDialog({
  open,
  onOpenChange,
  targetMealName,
  onApply,
  onBack,
}: Props) {
  const [templates, setTemplates] = useState<MealTemplate[] | null>(null);
  // Which template's food preview is expanded inline (the quick view).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Derive `loading` from the absence of data — avoids a synchronous
  // setState at the top of the load effect (react-hooks/set-state-in-effect).
  const loading = open && templates === null;

  // Bumps when a peer device's template change arrives via realtime;
  // re-runs the load effect so the dialog reflects the new list.
  const templatesRev = useDataRev("mealTemplates");

  // Load fresh whenever the dialog opens. Reset the list on close so the
  // next open starts in the loading state again. Reload too when the
  // realtime layer signals a peer change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listMealTemplates()
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          reportStorageError(err);
          setTemplates([]);
        }
      });
    return () => {
      cancelled = true;
      // On close (or re-open with a fresh request), drop the cached list
      // so the next open shows the loading state, and collapse any open
      // preview.
      setTemplates(null);
      setExpandedId(null);
    };
  }, [open, templatesRev]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent active:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <DialogHeader>
          <DialogTitle>Add from template</DialogTitle>
          <DialogDescription>
            Apply a saved template to <strong>{targetMealName}</strong>. The
            template&apos;s foods will be appended at their saved portions.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {loading ? (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              Loading…
            </p>
          ) : templates && templates.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              No templates saved yet. Use “Save as template” on a meal to create
              one.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {templates?.map((t) => {
                const totals = totalsOf(t.foods);
                return (
                  <li
                    key={t.id}
                    className="px-1 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onApply(t);
                          onOpenChange(false);
                        }}
                        className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                      >
                        <div className="truncate text-sm font-medium text-foreground">
                          {t.name}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {t.foods.length} food
                          {t.foods.length === 1 ? "" : "s"} ·{" "}
                          {Math.round(totals.calories)} kcal · P
                          {Math.round(totals.protein)} · C
                          {Math.round(totals.carbs)} · F{Math.round(totals.fat)}
                        </div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground sm:h-8 sm:w-8"
                        onClick={() =>
                          setExpandedId((id) => (id === t.id ? null : t.id))
                        }
                        aria-expanded={expandedId === t.id}
                        aria-label={`Preview ${t.name}`}
                      >
                        <Eye className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </Button>
                    </div>

                    {expandedId === t.id && (
                      <ul className="mt-2 space-y-1 rounded-md bg-muted/40 px-3 py-2">
                        {t.foods.map((f, i) => (
                          <li
                            key={`${f.name}-${i}`}
                            className="flex items-baseline justify-between gap-3 text-[11px]"
                          >
                            <span className="min-w-0 truncate text-foreground">
                              {f.name}
                            </span>
                            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                              {f.portionSize ? `${f.portionSize} g` : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
