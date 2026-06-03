"use client";

import { listDailyLogs, todayKey } from "@/lib/db";
import { pastMealsForSlot, type PastMeal } from "@/lib/recent-foods";
import { reportStorageError } from "@/lib/storage-status";
import { useEffect, useState } from "react";

/** Past instances of a meal slot (by name) for "copy a previous {slot}",
 *  loaded from IDB on mount / when the slot changes. */
export function usePastMealsForSlot(slotName: string): PastMeal[] {
  const [pastMeals, setPastMeals] = useState<PastMeal[]>([]);

  useEffect(() => {
    let cancelled = false;
    listDailyLogs()
      .then((logs) => {
        if (cancelled) return;
        setPastMeals(
          pastMealsForSlot(logs, slotName, { todayKey: todayKey() }),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setPastMeals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slotName]);

  return pastMeals;
}
