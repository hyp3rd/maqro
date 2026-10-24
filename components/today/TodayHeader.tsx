"use client";

import { Button } from "@/components/ui/button";
import { localDate, relativeDay } from "@/lib/today/timeline";
import { useLocale } from "next-intl";
import { addDays, isDateKey } from "@maqro/core/date";
import type { TrainingDayTargets } from "@maqro/core/targets";
import { DayTypeChip } from "./DayTypeChip";

/** "Today", "Yesterday", "Tomorrow", else the weekday ("Friday"). */
function dayTitle(date: string, today: string, locale: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
    localDate(date),
  );
}

/** "Change today’s session" / "Change Wednesday’s session" — the chip's
 *  action, worded like the day-type sheet's title. */
function editSessionLabel(date: string, today: string, locale: string) {
  if (date === today) return "Change today’s session";
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
    localDate(date),
  );
  return `Change ${weekday}’s session`;
}

/** The Today screen's header: the day (relative when it can be) under its
 *  full date, the session chip (training on; with `onEditDayType` it opens
 *  the day-type sheet), and — on any other day — a way back to today. The page's `h2` (the shell's top bar holds the
 *  `h1`). Before hydration the date key is empty: the header then reads
 *  "Today" with no date line. */
export function TodayHeader({
  date,
  today,
  training,
  titleId,
  onSelectDate,
  onEditDayType,
}: {
  date: string;
  today: string;
  training:
    Pick<TrainingDayTargets, "day" | "dayClass" | "overridden"> | undefined;
  titleId: string;
  onSelectDate: (date: string) => void;
  /** Change the shown day's session (the day-type sheet), given the chip
   *  to return focus to. Without it the chip is read-only. */
  onEditDayType?: (trigger: HTMLElement) => void;
}) {
  const locale = useLocale();
  const known = isDateKey(date) && isDateKey(today);
  const isToday = !known || relativeDay(date, today) === "today";
  const fullDate = known
    ? new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        // The year only when it isn't this one.
        year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
      }).format(localDate(date))
    : null;

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        {/* Reserved line, so the date arriving after hydration never shifts
            the screen. */}
        <p className="h-[1.125rem] text-label text-muted-foreground">
          {fullDate}
        </p>
        <h2
          id={titleId}
          className="text-2xl font-semibold leading-7 tracking-tight text-foreground"
        >
          {known ? dayTitle(date, today, locale) : "Today"}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        {!isToday && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Back to today"
            onClick={() => onSelectDate(today)}
          >
            Today
          </Button>
        )}
        <DayTypeChip
          training={training}
          onEdit={known ? onEditDayType : undefined}
          editLabel={known ? editSessionLabel(date, today, locale) : undefined}
        />
      </div>
    </header>
  );
}
