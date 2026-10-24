"use client";

import { Button } from "@/components/ui/button";
import { localDate, relativeDay } from "@/lib/today/timeline";
import { useId, useMemo, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale } from "next-intl";
import { addDays, isDateKey } from "@maqro/core/date";
import type { TrainingDayTargets } from "@maqro/core/targets";
import { DayTypeChip } from "./DayTypeChip";

/** The header's formatters for one locale, built once per locale rather
 *  than on every render (a search keystroke re-renders the day view). */
function headerFormats(locale: string) {
  const full = { weekday: "short", day: "numeric", month: "short" } as const;
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "long" }),
    fullDate: new Intl.DateTimeFormat(locale, full),
    // Another year's day names its year.
    fullDateWithYear: new Intl.DateTimeFormat(locale, {
      ...full,
      year: "numeric",
    }),
  };
}

type HeaderFormats = ReturnType<typeof headerFormats>;

/** "Today", "Yesterday", "Tomorrow", else the weekday ("Friday"). */
function dayTitle(date: string, today: string, formats: HeaderFormats) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return formats.weekday.format(localDate(date));
}

/** "Change today’s session" / "Change Wednesday’s session" — the chip's
 *  action, worded like the day-type sheet's title. */
function editSessionLabel(date: string, today: string, formats: HeaderFormats) {
  if (date === today) return "Change today’s session";
  return `Change ${formats.weekday.format(localDate(date))}’s session`;
}

/** The Today screen's header and the page's one heading (`h1`; the shell's
 *  top bar carries none on this view): the day, relative when it can be,
 *  under its full date. The date opens a date picker for any day, past or
 *  future (a future day can be planned, as on the week strip); the session
 *  chip (training on; with `onEditDayType` it opens the day-type sheet);
 *  and, on any other day, the one way back to today, which then puts
 *  focus on the heading so a keyboard or screen-reader user lands on the
 *  day they returned to. Before hydration the date key is empty: the
 *  header then reads "Today" with no date line. */
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
  const formats = useMemo(() => headerFormats(locale), [locale]);
  const pickerId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const known = isDateKey(date) && isDateKey(today);
  const isToday = !known || relativeDay(date, today) === "today";
  const fullDate = known
    ? (date.slice(0, 4) === today.slice(0, 4)
        ? formats.fullDate
        : formats.fullDateWithYear
      ).format(localDate(date))
    : null;

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        {/* Reserved line, so the date arriving after hydration never shifts
            the screen. */}
        <div className="relative h-[1.125rem] w-fit">
          {fullDate !== null && (
            <>
              <label
                htmlFor={pickerId}
                className="inline-flex items-center gap-1 text-label text-muted-foreground"
              >
                {fullDate}
                <ChevronDown
                  aria-hidden
                  className="h-3.5 w-3.5"
                />
                <span className="sr-only">, choose a day</span>
              </label>
              {/* Invisible over its label (and a little past it, for a
                  touch-sized target without moving the layout): a tap
                  opens the platform's date picker. */}
              <input
                id={pickerId}
                type="date"
                value={date}
                onClick={(event) => event.currentTarget.showPicker()}
                onChange={(event) => {
                  if (isDateKey(event.target.value))
                    onSelectDate(event.target.value);
                }}
                className="absolute -inset-x-1 -inset-y-2.5 cursor-pointer opacity-0"
              />
            </>
          )}
        </div>
        <h1
          ref={headingRef}
          id={titleId}
          // Focus target for "Back to today", never in the tab order.
          tabIndex={-1}
          className="rounded-sm text-2xl font-semibold leading-7 tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {known ? dayTitle(date, today, formats) : "Today"}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        {!isToday && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Back to today"
            onClick={() => {
              onSelectDate(today);
              // The button goes once today is shown; the heading stays.
              headingRef.current?.focus();
            }}
          >
            Today
          </Button>
        )}
        <DayTypeChip
          training={training}
          onEdit={known ? onEditDayType : undefined}
          editLabel={known ? editSessionLabel(date, today, formats) : undefined}
        />
      </div>
    </header>
  );
}
