"use client";

import { useElementWidth } from "@/hooks/use-element-width";
import { formatNumber } from "@/lib/i18n/number";
import {
  type TimelineSpan,
  elapsedMinutes,
  hourLabels,
  labelAnchor,
  mealTicks,
  minuteOfDay,
  nowFlagText,
  relativeDay,
  timelineSummary,
  trackPercent,
  workoutMealSpans,
  workoutSpan,
} from "@/lib/today/timeline";
import { dayTypeLabel } from "@/lib/training-labels";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";
import type { UsualMealMinutes } from "@maqro/core/meal-order";
import type { TrainingDayTargets } from "@maqro/core/targets";
import type { Meal } from "@maqro/core/types";
import type { WorkoutMealsPlan } from "@maqro/core/workout-meals";

const ANCHOR = {
  start: "translate-x-0",
  middle: "-translate-x-1/2",
  end: "-translate-x-full",
} as const;

const HOURS = Array.from({ length: 25 }, (_, h) => h);

/** The Today 24-hour timing track (Instrument): hour ticks across one local
 *  day with the part that has passed drawn brighter; a tick per meal with
 *  its kcal above it — an eaten meal's at its first logged food, a planned
 *  one's hollow at the time it is planned for (`mealTicks`; a meal with no
 *  time stays off the track); the day's session as an accent block (time +
 *  duration: the date's override when there is one, else the training
 *  template's) when training is on, with its workout meals' eating windows
 *  as lighter brackets either side; and, today only, a signal-coloured now
 *  cursor, flagged "Now HH:MM" (just "HH:MM" on a narrow phone, see
 *  `nowFlagText`).
 *
 *  `now` is injected (the caller's minute clock, `useNow`), so the cursor
 *  moves once a minute and tests pin the time; 0 = not known yet (server
 *  snapshot), no cursor. Pure positioning comes from lib/today/timeline.
 *
 *  One `role="img"` with a full summary as its name: the marks themselves
 *  are presentational. */
export function DayTimeline({
  meals,
  date,
  today,
  now,
  training,
  workoutMeals = null,
  usualMinutes = {},
  className,
}: {
  meals: readonly Meal[];
  date: string;
  today: string;
  now: number;
  /** The selected day's training (`DateTargets.training`); absent while
   *  training is off. */
  training?: Pick<TrainingDayTargets, "day" | "dayClass">;
  /** The day's workout meals (`workoutMealsForDay`), if any. */
  workoutMeals?: WorkoutMealsPlan | null;
  /** Each regular meal's usual time (`useUsualMealMinutes`): where a
   *  planned meal without a time of its own sits. */
  usualMinutes?: UsualMealMinutes;
  className?: string;
}) {
  // The track's measured width, so only the hour labels the now flag
  // really covers give way (until measured, the narrowest track's).
  const [trackRef, trackWidth] = useElementWidth<HTMLDivElement>();
  const when = relativeDay(date, today);
  const nowMinute = when === "today" && now > 0 ? minuteOfDay(now, date) : null;
  const elapsed = elapsedMinutes(date, today, now);
  const ticks = mealTicks(
    meals,
    { date, usual: usualMinutes, plan: workoutMeals },
    when,
  );
  const workout = training
    ? workoutSpan(training.day, dayTypeLabel(training))
    : null;
  const spans: TimelineSpan[] = [
    ...(workout ? [workout] : []),
    ...workoutMealSpans(workoutMeals),
  ].sort((a, b) => a.startMin - b.startMin);
  const locale = useLocale();
  const formatKcal = (kcal: number) => formatNumber(kcal, locale);
  const summary = timelineSummary({ ticks, spans, nowMinute, formatKcal });

  return (
    <div
      ref={trackRef}
      role="img"
      aria-label={`Day timeline: ${summary}`}
      className={cn("relative select-none", className)}
    >
      {/* Meal kcal labels; a second lane opens only when two meals sit
          close enough for their labels to overlap. */}
      <div
        className={cn(
          "relative",
          ticks.some((t) => t.lane === 1) ? "h-8" : "h-4",
        )}
      >
        {ticks.map((t) =>
          // No clear lane: the tick stands without a label.
          t.lane === null ? null : (
            <span
              key={t.mealId}
              className={cn(
                "absolute whitespace-nowrap font-mono text-xs leading-4 tabular-nums",
                t.planned ? "text-faint-foreground" : "text-muted-foreground",
                t.lane === 1 ? "bottom-4" : "bottom-0",
                ANCHOR[labelAnchor(t.minutes)],
              )}
              style={{ left: `${trackPercent(t.minutes)}%` }}
            >
              {formatKcal(t.kcal)}
            </span>
          ),
        )}
      </div>

      <div className="relative h-4">
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground/15"
        />
        <span
          aria-hidden
          data-part="elapsed"
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-foreground/60"
          style={{ width: `${trackPercent(elapsed)}%` }}
        />
        {HOURS.map((h) => (
          <span
            key={h}
            aria-hidden
            data-part="hour-tick"
            className={cn(
              "absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2",
              h % 6 === 0 ? "h-3" : "h-1.5",
              h * 60 <= elapsed ? "bg-foreground/50" : "bg-foreground/20",
            )}
            style={{ left: `${trackPercent(h * 60)}%` }}
          />
        ))}
        {spans.map((span) => (
          <span
            key={`${span.kind}-${span.startMin}`}
            aria-hidden
            data-part={span.kind}
            className={cn(
              "absolute top-1/2 min-w-1 -translate-y-1/2",
              span.kind === "workout"
                ? "h-2 rounded-sm bg-brand"
                : "h-1 rounded-full bg-brand/35",
            )}
            style={{
              left: `${trackPercent(span.startMin)}%`,
              width: `${trackPercent(span.endMin - span.startMin)}%`,
            }}
          />
        ))}
        {ticks.map((t) => (
          <span
            key={t.mealId}
            aria-hidden
            data-part="meal-tick"
            data-planned={t.planned || undefined}
            className={cn(
              "absolute inset-y-0 -translate-x-1/2 rounded-full",
              // Planned, not eaten yet: hollow, like the rail's node.
              t.planned
                ? "w-1.5 border border-foreground/70 bg-background"
                : "w-0.5 bg-foreground",
            )}
            style={{ left: `${trackPercent(t.minutes)}%` }}
          />
        ))}
        {nowMinute !== null && (
          <span
            aria-hidden
            data-part="now"
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-signal"
            style={{ left: `${trackPercent(nowMinute)}%` }}
          />
        )}
      </div>

      {/* Hour labels, kept clear of the "Now" flag. */}
      <div className="relative mt-1 h-4 font-mono text-xs leading-4 tabular-nums">
        {hourLabels(nowMinute, trackWidth ?? undefined).map((h) => (
          <span
            key={h}
            className={cn(
              "absolute text-faint-foreground",
              ANCHOR[labelAnchor(h * 60)],
            )}
            style={{ left: `${trackPercent(h * 60)}%` }}
          >
            {String(h).padStart(2, "0")}
          </span>
        ))}
        {nowMinute !== null && (
          <span
            className={cn(
              "absolute whitespace-nowrap font-medium text-signal",
              ANCHOR[labelAnchor(nowMinute)],
            )}
            style={{ left: `${trackPercent(nowMinute)}%` }}
          >
            {nowFlagText(nowMinute, trackWidth ?? undefined)}
          </span>
        )}
      </div>
    </div>
  );
}
