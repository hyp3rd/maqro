"use client";

import { railNodes } from "@/lib/today/rail";
import {
  formatClock,
  mealStartMinute,
  relativeDay,
} from "@/lib/today/timeline";
import { cn } from "@/lib/utils";
import type * as React from "react";
import type { Meal } from "@maqro/core/types";

const NODE = {
  logged: "bg-foreground",
  // Food on the plan, not logged as eaten: a dashed ring, between the
  // filled "logged" and the faint hollow "open".
  planned: "border-[1.5px] border-dashed border-foreground/70 bg-background",
  now: "bg-signal ring-4 ring-signal/20",
  open: "border-2 border-foreground/30 bg-background",
} as const;

/** The Today meal list on a rail that echoes the timing track: a filled
 *  node per logged meal (with the time its first food was logged), a
 *  dashed node for a planned one (food with no logged time — an AI
 *  auto-fill, a template; no time either), a highlighted node for today's
 *  next slot to log, hollow nodes for the rest. The time column is there
 *  only when some meal has a time, so an
 *  untimed day gives its width back to the cards. The meal cards
 *  themselves are the caller's (`renderMeal`), so every existing card
 *  action keeps working unchanged. */
export function MealRail({
  meals,
  date,
  today,
  renderMeal,
  className,
}: {
  meals: readonly Meal[];
  date: string;
  today: string;
  renderMeal: (meal: Meal) => React.ReactNode;
  className?: string;
}) {
  const entries = railNodes(meals, relativeDay(date, today));
  const starts = meals.map((meal) => mealStartMinute(meal, date));
  const timed = starts.some((start) => start !== null);

  return (
    <ol
      aria-label="Meals"
      className={cn("list-none", className)}
    >
      {meals.map((meal, i) => {
        const entry = entries[i] ?? { node: "open", lineStrong: false };
        const start = starts[i] ?? null;
        const last = i === meals.length - 1;
        return (
          <li
            key={meal.id}
            className={cn(
              "grid gap-x-2",
              timed
                ? "grid-cols-[2.5rem_0.75rem_minmax(0,1fr)]"
                : "grid-cols-[0.75rem_minmax(0,1fr)]",
            )}
          >
            {timed && (
              <span
                data-part="time"
                className="pt-[1.125rem] text-right font-mono text-xs leading-4 tabular-nums text-muted-foreground"
              >
                {start !== null ? formatClock(start) : ""}
              </span>
            )}
            <span
              aria-hidden
              className="relative"
            >
              {!last && (
                <span
                  className={cn(
                    "absolute bottom-0 left-1/2 top-[1.625rem] w-0.5 -translate-x-1/2",
                    entry.lineStrong ? "bg-foreground/45" : "bg-foreground/15",
                  )}
                />
              )}
              {i > 0 && (
                // The line arriving from the slot above, in its strength.
                <span
                  className={cn(
                    "absolute left-1/2 top-0 h-5 w-0.5 -translate-x-1/2",
                    entries[i - 1]?.lineStrong
                      ? "bg-foreground/45"
                      : "bg-foreground/15",
                  )}
                />
              )}
              <span
                data-node={entry.node}
                className={cn(
                  "absolute left-1/2 top-5 h-2.5 w-2.5 -translate-x-1/2 rounded-full",
                  NODE[entry.node],
                )}
              />
            </span>
            <div className="min-w-0">
              {entry.node === "now" && (
                <span className="sr-only">Next to log</span>
              )}
              {entry.node === "planned" && (
                <span className="sr-only">Planned, not logged yet</span>
              )}
              {renderMeal(meal)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
