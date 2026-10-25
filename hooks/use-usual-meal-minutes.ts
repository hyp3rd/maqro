"use client";

import { listDailyLogsBetween } from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useState } from "react";
import { addDays } from "@maqro/core/date";
import {
  USUAL_TIME_LOOKBACK_DAYS,
  type UsualMealMinutes,
  usualMealMinutes,
} from "@maqro/core/meal-order";

const NONE: UsualMealMinutes = {};

/** Each regular meal's usual time (`usualMealMinutes`) over the
 *  `USUAL_TIME_LOOKBACK_DAYS` before `today` (`""` = not known yet): where
 *  Today places a training day's workout meals among the others. Reads only
 *  those days from IndexedDB (a key-range read) and re-reads on every
 *  `dailyLogs` data-bus bump, so a history pulled on sign-in counts. Until a
 *  read lands, and after a storage failure (reported to the storage
 *  banner), there are no usual times and the defaults apply. */
export function useUsualMealMinutes(today: string): UsualMealMinutes {
  const [usual, setUsual] = useState<{
    today: string;
    minutes: UsualMealMinutes;
  } | null>(null);
  const rev = useDataRev("dailyLogs");

  useEffect(() => {
    if (today === "") return;
    let cancelled = false;
    listDailyLogsBetween(
      addDays(today, -USUAL_TIME_LOOKBACK_DAYS),
      addDays(today, -1),
    )
      .then((logs) => {
        if (cancelled) return;
        const minutes = usualMealMinutes(logs);
        // Most saves change no usual time (today isn't history): keep the
        // same object, so the day's meals aren't re-derived for nothing.
        setUsual((prev) =>
          prev?.today === today &&
          JSON.stringify(prev.minutes) === JSON.stringify(minutes)
            ? prev
            : { today, minutes },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportStorageError(err);
        setUsual({ today, minutes: NONE });
      });
    return () => {
      cancelled = true;
    };
  }, [today, rev]);

  // A read for another day never stands in for this one.
  return usual !== null && usual.today === today ? usual.minutes : NONE;
}
