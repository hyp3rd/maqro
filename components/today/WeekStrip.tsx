"use client";

import { haptic } from "@/lib/haptics";
import { formatNumber } from "@/lib/i18n/number";
import { localDate } from "@/lib/today/timeline";
import {
  STRIP_TICK,
  type StripDay,
  weekStripDays,
} from "@/lib/today/week-strip";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useLocale } from "next-intl";

/** The strip's formatters for one locale, built once per locale rather
 *  than three per day on every render (a search keystroke re-renders the
 *  day view). A compact "+1.3K" keeps a large overshoot inside its cell;
 *  the day's accessible name still carries the full figure. */
function stripFormats(locale: string) {
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }),
    day: new Intl.DateTimeFormat(locale, { day: "numeric" }),
    month: new Intl.DateTimeFormat(locale, { month: "short" }),
    compact: new Intl.NumberFormat(locale, { notation: "compact" }),
  };
}

type StripFormats = ReturnType<typeof stripFormats>;

function dayNames(key: string, formats: StripFormats) {
  const date = localDate(key);
  return {
    weekday: formats.weekday.format(date),
    day: formats.day.format(date),
    month: formats.month.format(date),
  };
}

/** Overshoots under 1,000 read whole ("+110"); from 1,000 the strip's
 *  ~5-character cell takes the locale's compact form ("+1.3K", "+1,3K"). */
const COMPACT_FROM = 1000;

function accessibleName(
  day: StripDay,
  name: string,
  show: (n: number) => string,
): string {
  const kcal = (n: number) => `${show(n)} kcal`;
  const parts = [name];
  if (day.when === "today") parts.push("today");
  if (day.target <= 0) {
    parts.push(day.eaten > 0 ? kcal(day.eaten) : "nothing logged");
  } else if (day.eaten <= 0) {
    parts.push(`target ${kcal(day.target)}`);
  } else {
    const suffix =
      day.when === "today"
        ? " so far"
        : day.when === "future"
          ? " planned"
          : "";
    parts.push(`${show(day.eaten)} of ${kcal(day.target)}${suffix}`);
    if (day.over > 0) parts.push(`${show(day.over)} above target`);
  }
  return parts.join(", ");
}

/** Bar fills per position in time: today in the accent, past days neutral,
 *  future days hollow (with any planned food faint). Static strings so
 *  Tailwind sees them. */
const FILL = {
  today: { fill: "bg-brand", nub: "bg-brand/40" },
  past: { fill: "bg-foreground/70", nub: "bg-foreground/30" },
  future: { fill: "bg-foreground/25", nub: "bg-foreground/15" },
} as const;

/** The Today week strip (Instrument): Monday → Sunday of the selected day's
 *  week, each bar that day's eaten kcal against ITS OWN target (a tick at
 *  the same place on every bar). An overshoot is a faint nub past the tick
 *  plus a neutral "+N" — no colour judgement. Tapping a day selects it, past
 *  or future. Today is `aria-current="date"`; the shown day is pressed. */
export function WeekStrip({
  days,
  eatenByDate,
  today,
  selectedDate,
  onSelect,
  className,
}: {
  days: readonly { date: string; targetCalories: number }[];
  eatenByDate: ReadonlyMap<string, number>;
  today: string;
  selectedDate: string;
  onSelect: (date: string) => void;
  className?: string;
}) {
  const locale = useLocale();
  const formats = useMemo(() => stripFormats(locale), [locale]);
  const show = (n: number) => formatNumber(n, locale);
  const showOver = (n: number) =>
    n >= COMPACT_FROM ? formats.compact.format(n) : show(n);
  const strip = weekStripDays(days, eatenByDate, today, selectedDate);

  return (
    // A labelled group, not a <nav>: it picks a day within the view, and the
    // landmark list stays the app's own navigation.
    <div
      role="group"
      aria-label="Week"
      className={className}
    >
      <ul className="grid grid-cols-7 gap-1">
        {strip.map((day) => {
          const names = dayNames(day.date, formats);
          const tone = FILL[day.when];
          return (
            <li key={day.date}>
              <button
                type="button"
                aria-label={accessibleName(
                  day,
                  `${names.weekday} ${names.day} ${names.month}`,
                  show,
                )}
                aria-current={day.when === "today" ? "date" : undefined}
                aria-pressed={day.selected}
                onClick={() => {
                  if (day.selected) return;
                  haptic("select");
                  onSelect(day.date);
                }}
                className={cn(
                  "flex min-h-16 w-full flex-col items-center gap-0.5 rounded-lg border px-1 pb-1 pt-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  day.selected
                    ? "border-brand/40 bg-brand/10"
                    : "border-transparent hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "text-xs leading-4",
                    day.when === "today"
                      ? "font-semibold text-brand-text"
                      : "text-muted-foreground",
                  )}
                >
                  {names.weekday}
                </span>
                <span
                  className={cn(
                    "font-mono text-[0.9375rem] font-medium leading-5 tabular-nums",
                    day.when === "future"
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {names.day}
                </span>
                <span
                  aria-hidden
                  className="relative mt-1 block h-[7px] w-full max-w-10"
                >
                  <span
                    data-part="track"
                    className={cn(
                      "absolute left-0 top-[2px] h-[3px] rounded-full",
                      day.when === "future"
                        ? "border border-foreground/25"
                        : "bg-foreground/10",
                    )}
                    style={{ width: `${STRIP_TICK * 100}%` }}
                  />
                  {day.bar.fill > 0 && (
                    <span
                      data-part="fill"
                      className={cn(
                        "absolute left-0 top-[2px] h-[3px] rounded-full",
                        tone.fill,
                      )}
                      style={{ width: `${day.bar.fill * 100}%` }}
                    />
                  )}
                  {day.bar.nub > 0 && (
                    <span
                      data-part="nub"
                      className={cn(
                        "absolute top-[2px] h-[3px] rounded-r-full",
                        tone.nub,
                      )}
                      style={{
                        left: `${STRIP_TICK * 100}%`,
                        width: `${day.bar.nub * 100}%`,
                      }}
                    />
                  )}
                  {day.target > 0 && (
                    <span
                      data-part="tick"
                      className="absolute inset-y-0 w-px bg-faint-foreground"
                      style={{ left: `${STRIP_TICK * 100}%` }}
                    />
                  )}
                </span>
                {/* Reserved so a "+N" appearing never shifts the row. It
                    spans the cell's full width (the button's padding
                    included: a 320 px phone leaves ~37 px, room for a
                    five-character "+1.3K") and is clipped to it, so it
                    never runs into the next day. */}
                <span
                  aria-hidden
                  className="-mx-1 h-4 w-[calc(100%+0.5rem)] overflow-hidden whitespace-nowrap text-center font-mono text-xs leading-4 tabular-nums text-muted-foreground"
                >
                  {day.over > 0 ? `+${showOver(day.over)}` : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
