"use client";

import { listDailyLogs, todayKey, type DailyLog } from "@/lib/db";
import {
  recentLoggedFoods,
  type RecentFood,
  type RecentSort,
} from "@/lib/recent-foods";
import { reportStorageError } from "@/lib/storage-status";
import { useEffect, useMemo, useState } from "react";

/** Recently-logged foods for the quick-add lists, loaded from IDB once on
 *  mount and re-sorted in memory when the Recent⇄Frequent toggle flips (no
 *  re-read). `loaded` lets the UI avoid flashing an empty state before the
 *  (sub-millisecond) IDB read resolves. */
export function useRecentFoods(opts?: { limit?: number; sort?: RecentSort }): {
  recents: RecentFood[];
  loaded: boolean;
} {
  const [logs, setLogs] = useState<DailyLog[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDailyLogs()
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const limit = opts?.limit;
  const sort = opts?.sort;
  const recents = useMemo(
    () =>
      logs
        ? recentLoggedFoods(logs, { todayKey: todayKey(), limit, sort })
        : [],
    [logs, limit, sort],
  );

  return { recents, loaded: logs !== null };
}
