"use client";

import { formatNumber } from "@/lib/i18n/number";
import { dayTypeLabel } from "@/lib/today/day-type";
import {
  type TimelineSpan,
  elapsedMinutes,
  formatClock,
  hourLabels,
  labelAnchor,
  mealTicks,
  minuteOfDay,
  relativeDay,
  timelineSummary,
  trackPercent,
  workoutSpan,
} from "@/lib/today/timeline";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";
import type { TrainingDayTargets } from "@maqro/core/targets";
import type { Meal } from "@maqro/core/types";

const ANCHOR = {
  start: "translate-x-0",
  middle: "-translate-x-1/2",
  end: "-translate-x-full",
} as const;

const HOURS = Array.from({ length: 25 }, (_, h) => h);

/** The Today 24-hour timing track (Instrument): hour ticks across one local
 *  day with the part that has passed drawn brighter; a tick per meal at its
 *  first logged food with the meal's kcal above it (meals without a logged
 *  time stay off the track); the planned workout as an accent block from
 *  the training template (time + duration) when training is on; and, today
 *  only, a signal-coloured "Now HH:MM" cursor.
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
  className,
}: {
  meals: readonly Meal[];
  date: string;
  today: string;
  now: number;
  /** The selected day's training (`DateTargets.training`); absent while
   *  training is off. */
  training?: Pick<TrainingDayTargets, "day" | "dayClass">;
  className?: string;
}) {
  const isToday = relativeDay(date, today) === "today";
  const nowMinute = isToday && now > 0 ? minuteOfDay(now, date) : null;
  const elapsed = elapsedMinutes(date, today, now);
  const ticks = mealTicks(meals, date);
  const workout = training
    ? workoutSpan(training.day, dayTypeLabel(training))
    : null;
  const spans: TimelineSpan[] = workout ? [workout] : [];
  const locale = useLocale();
  const formatKcal = (kcal: number) => formatNumber(kcal, locale);
  const summary = timelineSummary({ ticks, spans, nowMinute, formatKcal });

  return (
    <div
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
        {ticks.map((t) => (
          <span
            key={t.mealId}
            className={cn(
              "absolute whitespace-nowrap font-mono text-xs leading-4 tabular-nums text-muted-foreground",
              t.lane === 1 ? "bottom-4" : "bottom-0",
              ANCHOR[labelAnchor(t.minutes)],
            )}
            style={{ left: `${trackPercent(t.minutes)}%` }}
          >
            {formatKcal(t.kcal)}
          </span>
        ))}
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
            className="absolute top-1/2 h-2 min-w-1 -translate-y-1/2 rounded-sm bg-brand"
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
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
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
        {hourLabels(nowMinute).map((h) => (
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
            Now {formatClock(nowMinute)}
          </span>
        )}
      </div>
    </div>
  );
}
