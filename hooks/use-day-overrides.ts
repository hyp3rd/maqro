"use client";

import {
  type TrainingDayOverride,
  deleteDayOverride,
  listDayOverrides,
  saveDayOverride,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useState } from "react";
import type { TrainingDay } from "@maqro/core/types";

/** This device's per-date training-session overrides (FREE) and their
 *  mutators. Re-reads on every `trainingDayOverrides` data-bus bump — local
 *  writes, sync pulls and realtime arrivals — so every target built from
 *  them (`useTargets`) follows a change made anywhere.
 *
 *  The rows are returned raw: `targetsForDate` validates each `day` and
 *  ignores a malformed one. Each write bumps the sync-pending counter like
 *  every user-facing write; a failed write is reported to the storage
 *  banner and resolves `false`, so the caller never treats it as saved. */
export function useDayOverrides(): {
  overrides: TrainingDayOverride[];
  loaded: boolean;
  /** Replace `date`'s template session with `day`. */
  setOverride: (date: string, day: TrainingDay) => Promise<boolean>;
  /** "Back to plan": remove `date`'s override (synced as a delete). */
  clearOverride: (date: string) => Promise<boolean>;
} {
  const rev = useDataRev("trainingDayOverrides");
  const [overrides, setOverrides] = useState<TrainingDayOverride[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDayOverrides()
      .then((rows) => {
        if (cancelled) return;
        setOverrides(rows);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportStorageError(err);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  const setOverride = useCallback(async (date: string, day: TrainingDay) => {
    try {
      await saveDayOverride(date, day);
    } catch (err) {
      reportStorageError(err);
      return false;
    }
    bumpPending();
    return true;
  }, []);

  const clearOverride = useCallback(async (date: string) => {
    try {
      await deleteDayOverride(date);
    } catch (err) {
      reportStorageError(err);
      return false;
    }
    bumpPending();
    return true;
  }, []);

  return { overrides, loaded, setOverride, clearOverride };
}
