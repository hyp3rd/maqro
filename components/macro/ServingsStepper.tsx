"use client";

import { Button } from "@/components/ui/button";
import {
  MAX_RECIPE_SCALE,
  MIN_RECIPE_SCALE,
  clampScale,
  formatScale,
} from "@/lib/scale-recipe";
import { Minus, Plus } from "lucide-react";

/** −  1×  +  stepper for recipe-apply servings.
 *
 *  Step is variable on purpose: between MIN (0.25) and 1×, the step
 *  is 0.25 (gives the user 0.25 / 0.5 / 0.75 / 1); from 1× upward,
 *  the step is 1 (1 / 2 / 3 / …). This matches how cooks think -
 *  "a quarter recipe, half, three-quarters, then doubles / triples"
 *  - and avoids the awkward 1.25× / 1.5× zone that's almost never
 *  what someone wants when batch-prepping. */
export function ServingsStepper({
  value,
  onChange,
  label = "Servings",
}: {
  value: number;
  onChange: (next: number) => void;
  label?: string;
}) {
  const canDec = value > MIN_RECIPE_SCALE;
  const canInc = value < MAX_RECIPE_SCALE;

  function step(direction: 1 | -1) {
    // Below 1× the granularity is 0.25; at and above 1× it's 1.
    // We pick the step based on the *target* of the move (i.e. the
    // value AFTER subtracting/adding), so the user can cross 1×
    // smoothly without needing two clicks to escape the fractional
    // zone.
    if (direction === -1) {
      const next = value <= 1 ? value - 0.25 : value - 1;
      onChange(clampScale(next));
      return;
    }
    const next = value < 1 ? value + 0.25 : value + 1;
    onChange(clampScale(next));
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="inline-flex h-9 items-center rounded-md border border-border/60 bg-background">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-none rounded-l-md"
          onClick={() => step(-1)}
          disabled={!canDec}
          aria-label="Decrease servings"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span
          aria-live="polite"
          className="min-w-[3.5ch] px-2 text-center font-mono text-sm tabular-nums"
        >
          {formatScale(value)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-none rounded-r-md"
          onClick={() => step(1)}
          disabled={!canInc}
          aria-label="Increase servings"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
