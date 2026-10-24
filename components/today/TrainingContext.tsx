"use client";

import { localDate, relativeDay } from "@/lib/today/timeline";
import { trainingContextLine } from "@/lib/today/training-context";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useLocale } from "next-intl";
import { addDays, isDateKey } from "@maqro/core/date";
import type { DateTargets } from "@maqro/core/targets";

/** The calm line under the Today gauge on a training day: "Carbs are
 *  higher today — heavy session at 18:00" (see `trainingContextLine`).
 *  Renders nothing on a rest day, with training off, or when the session
 *  left the day at the weekly average. Muted, never a warning colour. */
export function TrainingContext({
  day,
  today,
  className,
}: {
  day: DateTargets;
  today: string;
  className?: string;
}) {
  const locale = useLocale();
  const weekday = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "long" }),
    [locale],
  );
  if (!isDateKey(day.date) || !isDateKey(today)) return null;
  const when = relativeDay(day.date, today);
  const phrase =
    when === "today"
      ? "today"
      : day.date === addDays(today, -1)
        ? "yesterday"
        : day.date === addDays(today, 1)
          ? "tomorrow"
          : `on ${weekday.format(localDate(day.date))}`;
  const line = trainingContextLine(day, when, phrase);
  if (line === null) return null;
  return (
    <p
      data-part="training-context"
      className={cn("text-label text-muted-foreground", className)}
    >
      {line}
    </p>
  );
}
