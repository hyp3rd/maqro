"use client";

import { useToday } from "@/hooks/use-today";
import {
  listDailyLogs,
  listWeightEntries,
  type DailyLog,
  type WeightEntry,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { inferAdaptiveTdee, type AdaptiveTdee } from "@/lib/trends";
import { useEffect, useMemo, useState } from "react";

/** Loads weight + daily-log history from IDB and returns the adaptive-TDEE
 *  estimate — the same maintenance read Progress → Trends shows — so any
 *  surface can suggest it (e.g. the Calculator's manual-TDEE field). Refreshes
 *  on the weight / daily-log data-bus revisions. A load failure degrades to the
 *  "no estimate" result (the suggestion is best-effort) and is reported, not
 *  swallowed. */
export function useAdaptiveTdee(): AdaptiveTdee {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const weightRev = useDataRev("weightHistory");
  const logsRev = useDataRev("dailyLogs");
  // `useToday()` flips at local midnight, so the intake cutoff re-derives at
  // the day boundary even when no weigh-in / log changed.
  const today = useToday();

  useEffect(() => {
    let cancelled = false;
    Promise.all([listWeightEntries(), listDailyLogs()])
      .then(([w, l]) => {
        if (cancelled) return;
        setWeights(w);
        setLogs(l);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [weightRev, logsRev]);

  return useMemo(() => {
    const intake = logs
      .filter((l) => l.date <= today)
      .map((l) => ({
        date: l.date,
        calories: l.meals.reduce(
          (s, m) => s + m.foods.reduce((ms, f) => ms + f.calories, 0),
          0,
        ),
      }));
    return inferAdaptiveTdee({ weights, intake });
  }, [weights, logs, today]);
}
