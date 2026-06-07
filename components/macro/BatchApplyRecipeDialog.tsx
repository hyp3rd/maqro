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
import {
  addDays,
  enumerateDateRange,
  filterByDayOfWeek,
} from "@/lib/batch-apply";
import {
  addMealSchedule,
  type MealSchedule,
  todayKey,
  upsertMealSchedule,
} from "@/lib/db";
import { useState } from "react";
import { toast } from "sonner";
import { ServingsStepper } from "./ServingsStepper";
import type { Meal, Recipe } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The recipe to schedule across multiple (date, meal-slot) cells. */
  recipe: Recipe;
  /** The user's current meal-slot structure — the set of slot-name
   *  checkboxes the user picks targets from. Matched by name on the day. */
  currentMeals: readonly Meal[];
  /** When set, edit this existing schedule instead of creating a new one
   *  (the form pre-fills from it and `save()` upserts). */
  editing?: MealSchedule;
};

/** Default DOW set: Mon–Fri only. Catches the most common
 *  meal-prep use case ("Sunday cook for the work week") without
 *  needing the user to uncheck weekend boxes. They can flip them on
 *  with one click. */
const WEEKDAY_SET: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DOW_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function BatchApplyRecipeDialog({
  open,
  onOpenChange,
  recipe,
  currentMeals,
  editing,
}: Props) {
  const today = todayKey();
  // Default range: today through six days out = a one-week meal plan. Most
  // "Sunday cook for the week" users want exactly this. When editing, the
  // existing schedule's range / days / slots / scale pre-fill instead.
  const [startDate, setStartDate] = useState(editing?.startDate ?? today);
  const [endDate, setEndDate] = useState(editing?.endDate ?? addDays(today, 6));
  const [allowedDows, setAllowedDows] = useState<ReadonlySet<number>>(() =>
    editing ? new Set(editing.daysOfWeek) : new Set(WEEKDAY_SET),
  );
  // Default to the current day's first lunch-shaped slot (index 1 of the
  // typical Breakfast/Lunch/Dinner/Snacks template), falling back to the
  // first slot. When editing, resolve the schedule's saved slot NAMES back
  // to the matching current-meal ids.
  const [selectedMealIds, setSelectedMealIds] = useState<ReadonlySet<number>>(
    () => {
      if (editing) {
        const names = new Set(
          editing.mealNames.map((n) => n.trim().toLowerCase()),
        );
        return new Set(
          currentMeals
            .filter((m) => names.has(m.name.trim().toLowerCase()))
            .map((m) => m.id),
        );
      }
      const initial = currentMeals[1] ?? currentMeals[0];
      return new Set(initial ? [initial.id] : []);
    },
  );
  const [busy, setBusy] = useState(false);
  // Servings multiplier stored on the schedule and applied to the recipe at
  // log time. 2× doubles every portion; 0.5× halves. Per-schedule, not
  // per-day — the meal-prep case is "cook 5 servings for the week."
  const [scale, setScale] = useState(editing?.scale ?? 1);

  const allDatesInRange = enumerateDateRange(startDate, endDate);
  const selectedDates = filterByDayOfWeek(allDatesInRange, allowedDows);
  const canApply =
    !busy &&
    selectedDates.length > 0 &&
    selectedMealIds.size > 0 &&
    startDate <= endDate;

  function toggleDow(dow: number) {
    setAllowedDows((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  }

  function toggleMealId(id: number) {
    setSelectedMealIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      // Store slot NAMES (lower-cased), not ids: meal-template edits give a
      // user different slot ids over time, but the name is the stable handle
      // the on-day matcher uses.
      const mealNames = currentMeals
        .filter((m) => selectedMealIds.has(m.id))
        .map((m) => m.name.trim().toLowerCase());
      const daysOfWeek = [...allowedDows].sort((a, b) => a - b);
      if (editing) {
        await upsertMealSchedule({
          ...editing,
          recipeId: recipe.id,
          recipeName: recipe.name,
          mealNames,
          startDate,
          endDate,
          daysOfWeek,
          scale,
        });
        toast.success(`Updated the schedule for ${recipe.name}.`);
      } else {
        await addMealSchedule({
          recipeId: recipe.id,
          recipeName: recipe.name,
          mealNames,
          startDate,
          endDate,
          daysOfWeek,
          scale,
        });
        toast.success(
          `Scheduled ${recipe.name} for ${selectedDates.length} day${
            selectedDates.length === 1 ? "" : "s"
          }.`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the schedule.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-tight">
            {editing ? "Edit schedule" : "Cook once, log for…"}
          </DialogTitle>
          <DialogDescription>
            Schedule <strong>{recipe.name}</strong> across several days and
            slots. We&apos;ll offer a one-tap log on each matching day — nothing
            is logged now.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="batch-from"
                className="text-xs font-medium text-muted-foreground"
              >
                From
              </Label>
              <Input
                id="batch-from"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="batch-to"
                className="text-xs font-medium text-muted-foreground"
              >
                To
              </Label>
              <Input
                id="batch-to"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Days of the week
            </p>
            <div className="flex gap-1">
              {DOW_LABELS.map((label, dow) => {
                const active = allowedDows.has(dow);
                return (
                  <button
                    key={dow}
                    type="button"
                    onClick={() => toggleDow(dow)}
                    aria-pressed={active}
                    aria-label={DOW_FULL[dow]}
                    className={`h-9 flex-1 rounded-md border text-xs font-medium transition-colors ${
                      active
                        ? "border-foreground/40 bg-foreground text-background"
                        : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Meal slots
            </p>
            <div className="flex flex-wrap gap-1.5">
              {currentMeals.map((m) => {
                const active = selectedMealIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMealId(m.id)}
                    aria-pressed={active}
                    className={`inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-medium transition-colors ${
                      active
                        ? "border-foreground/40 bg-foreground text-background"
                        : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40"
                    }`}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <ServingsStepper
              value={scale}
              onChange={setScale}
            />
            {scale !== 1 && (
              <span className="text-[11px] text-muted-foreground">
                Each portion × {scale.toFixed(2).replace(/\.?0+$/, "")}
              </span>
            )}
          </div>

          <PreviewLine
            dates={selectedDates}
            mealCount={selectedMealIds.size}
            mealNames={currentMeals
              .filter((m) => selectedMealIds.has(m.id))
              .map((m) => m.name)}
            invalidRange={startDate > endDate}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!canApply}
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewLine({
  dates,
  mealCount,
  mealNames,
  invalidRange,
}: {
  dates: readonly string[];
  mealCount: number;
  mealNames: readonly string[];
  invalidRange: boolean;
}) {
  if (invalidRange) {
    return (
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
        End date is before the start date.
      </p>
    );
  }
  if (dates.length === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        No days match the current selection — pick a wider range or enable more
        weekdays.
      </p>
    );
  }
  if (mealCount === 0) {
    return (
      <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        Pick at least one meal slot.
      </p>
    );
  }
  const slotLabel =
    mealNames.length <= 2
      ? mealNames.join(" and ")
      : `${mealNames.length} meal slots`;
  const first = dates[0];
  const last = dates[dates.length - 1];
  return (
    <p className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
      We&apos;ll offer to log it on <strong>{slotLabel}</strong> across{" "}
      <strong>
        {dates.length} day{dates.length === 1 ? "" : "s"}
      </strong>{" "}
      ({prettyDate(first ?? "")} → {prettyDate(last ?? "")}).
    </p>
  );
}

function prettyDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
