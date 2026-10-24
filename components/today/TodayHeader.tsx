"use client";

import { openDatePicker } from "@/lib/today/date-picker";
import { localDate, relativeDay } from "@/lib/today/timeline";
import { cn } from "@/lib/utils";
import type * as React from "react";
import { useMemo, useRef, useState } from "react";
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

/** A quiet text button on the date line, as tall as the line. On a touch
 *  screen an invisible hit-slop (`::before`) reaches 44 px, 13 px above
 *  and below the 18 px line, so the target grows without moving the
 *  layout: into the shell's top padding and over the heading's leading
 *  (the heading isn't a control). Focus is drawn on the face (the text),
 *  not on the larger target. */
const LINE_BUTTON =
  "group relative flex h-full items-end text-label outline-none before:content-[''] hover:text-foreground coarse:before:absolute coarse:before:-inset-x-1 coarse:before:-inset-y-[13px]";
const LINE_BUTTON_FACE =
  "inline-flex items-center rounded-sm ring-offset-background group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2";

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
 *  under its full date, with the day's `actions` (streak, Share) at the end
 *  of the title's row. The date is a button that opens the platform's date picker
 *  for any day, past or future (a future day can be planned, as on the week
 *  strip); where the browser can't open one, it becomes a visible date
 *  field instead. On any other day the date line ends with the one way
 *  back to today, which then puts focus on the heading so a keyboard or
 *  screen-reader user lands on the day they returned to. Below the title:
 *  the session chip (training on; with `onEditDayType` it opens the
 *  day-type sheet). Before hydration the date key is empty: the
 *  header then reads "Today" with no date line. */
export function TodayHeader({
  date,
  today,
  training,
  titleId,
  onSelectDate,
  onEditDayType,
  actions,
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
  /** The day's quiet extras (the logging streak, Share), at the end of
   *  the title row so the instrument below starts right away. */
  actions?: React.ReactNode;
}) {
  const locale = useLocale();
  const formats = useMemo(() => headerFormats(locale), [locale]);
  const pickerRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The browser couldn't open its picker: show the date field itself.
  const [typingDate, setTypingDate] = useState(false);
  const selectFromField = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isDateKey(event.target.value)) onSelectDate(event.target.value);
  };
  const known = isDateKey(date) && isDateKey(today);
  const isToday = !known || relativeDay(date, today) === "today";
  const fullDate = known
    ? (date.slice(0, 4) === today.slice(0, 4)
        ? formats.fullDate
        : formats.fullDateWithYear
      ).format(localDate(date))
    : null;

  return (
    <header className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {/* The date line: the date (the picker's trigger) and, on any other
            day, the way back to today. Reserved even before the date
            arrives, so it never shifts the screen. One 18 px line on every
            pointer; on a touch screen its buttons' hit-slop reaches 44 px
            without taking layout space. */}
          <div
            data-part="date-line"
            className="flex h-[1.125rem] items-end gap-4"
          >
            <div className="relative flex h-full min-w-0 items-end">
              {fullDate !== null &&
                (typingDate ? (
                  <input
                    // Shown only in answer to the user's own tap, so focus
                    // follows it there.
                    ref={(field) => field?.focus()}
                    type="date"
                    aria-label={`${fullDate}, choose a day`}
                    value={date}
                    onChange={selectFromField}
                    onBlur={() => setTypingDate(false)}
                    // On a touch screen it rises from the line's foot into
                    // the shell's 16 px top padding (32 px tall), as the
                    // buttons' hit-slop does, without moving the layout.
                    className="h-[1.125rem] rounded-sm border border-input bg-background px-1 text-label text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-8"
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const field = pickerRef.current;
                        if (field && openDatePicker(field) === "unavailable")
                          setTypingDate(true);
                      }}
                      className={cn(LINE_BUTTON, "text-muted-foreground")}
                    >
                      <span
                        data-part="date-trigger-face"
                        className={cn(LINE_BUTTON_FACE, "gap-1")}
                      >
                        {fullDate}
                        <ChevronDown
                          aria-hidden
                          className="h-3.5 w-3.5"
                        />
                        <span className="sr-only">, choose a day</span>
                      </span>
                    </button>
                    {/* The picker's anchor, a 1 px field at the date's foot:
                    out of the tab order and the accessibility tree, since
                    the button is the control. */}
                    <input
                      ref={pickerRef}
                      type="date"
                      tabIndex={-1}
                      aria-hidden
                      value={date}
                      onChange={selectFromField}
                      className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
                    />
                  </>
                ))}
            </div>
            {!isToday && (
              <button
                type="button"
                aria-label="Back to today"
                className={cn(LINE_BUTTON, "shrink-0 text-brand-text")}
                onClick={() => {
                  onSelectDate(today);
                  // The button goes once today is shown; the heading stays.
                  headingRef.current?.focus();
                }}
              >
                <span className={cn(LINE_BUTTON_FACE, "font-medium")}>
                  Today
                </span>
              </button>
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
        {/* Level with the title, at the foot of the row. */}
        {actions !== undefined && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {/* The session (with its start) reads as the day's subtitle, on its
          own row so a long one never squeezes the title or the actions. */}
      {training !== undefined && (
        <DayTypeChip
          training={training}
          onEdit={known ? onEditDayType : undefined}
          editLabel={known ? editSessionLabel(date, today, formats) : undefined}
        />
      )}
    </header>
  );
}
