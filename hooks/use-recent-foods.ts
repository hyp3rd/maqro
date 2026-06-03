"use client";

import { listDailyLogs, todayKey } from "@/lib/db";
import { recentLoggedFoods, type RecentFood } from "@/lib/recent-foods";
import { reportStorageError } from "@/lib/storage-status";
import { useEffect, useState } from "react";

/** Recently-logged foods for the quick-add list, loaded from IDB once on
 *  mount. The food-search sheet mounts/unmounts with each open, so this
 *  re-reads fresh recents every time it's opened. `loaded` lets the UI
 *  avoid flashing the "start typing" hint before the (sub-millisecond)
 *  IDB read resolves. */
export function useRecentFoods(limit?: number): {
  recents: RecentFood[];
  loaded: boolean;
} {
  const [recents, setRecents] = useState<RecentFood[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDailyLogs()
      .then((logs) => {
        if (cancelled) return;
        setRecents(recentLoggedFoods(logs, { todayKey: todayKey(), limit }));
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setRecents([]);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { recents, loaded };
}
