"use client";

import { listDailyLogsBetween } from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { relativeDay } from "@/lib/today/timeline";
import { dayCalories } from "@/lib/today/week-strip";
import { useEffect, useState } from "react";
import { addDays } from "@maqro/core/date";

const EMPTY: ReadonlyMap<string, number> = new Map();

/** Eaten kcal per day for the Monday-first week starting `weekStart`
 *  (`null` = no week yet): the Today week strip — on `today`, only food
 *  logged as eaten (`dayCalories`). Reads only those seven days from
 *  IndexedDB (a key-range read) and re-reads on every `dailyLogs`
 *  data-bus bump — a local save or a peer's realtime change. Days
 *  without a log are absent from the map. A storage failure is reported
 *  to the storage banner and the strip shows no intake. */
export function useWeekIntake(
  weekStart: string | null,
  today: string,
): ReadonlyMap<string, number> {
  const [intake, setIntake] = useState<{
    weekStart: string;
    kcal: ReadonlyMap<string, number>;
  } | null>(null);
  const rev = useDataRev("dailyLogs");

  useEffect(() => {
    if (weekStart === null) return;
    let cancelled = false;
    listDailyLogsBetween(weekStart, addDays(weekStart, 6))
      .then((logs) => {
        if (cancelled) return;
        setIntake({
          weekStart,
          kcal: new Map(
            logs.map((log) => [
              log.date,
              dayCalories(log.meals, relativeDay(log.date, today)),
            ]),
          ),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportStorageError(err);
        setIntake({ weekStart, kcal: EMPTY });
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, today, rev]);

  // A read for a previous week never shows against a new one.
  return intake !== null && intake.weekStart === weekStart
    ? intake.kcal
    : EMPTY;
}
