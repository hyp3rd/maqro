"use client";

import { addWater, getWaterIntake, setWaterTotal } from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useState } from "react";

/** A single day's water total in millilitres + tap-to-log mutators.
 *  Re-reads on every `waterIntake` data-bus bump (local taps and realtime
 *  arrivals) and whenever `date` changes. The daily goal lives on the
 *  profile (the caller computes it via `waterGoalMl`), so this hook owns
 *  only the stored total. `loaded` lets the UI avoid a flash before the
 *  (sub-millisecond) IDB read resolves. */
export function useWaterIntake(date: string): {
  ml: number;
  loaded: boolean;
  addWater: (deltaMl: number) => Promise<void>;
  setTotal: (ml: number) => Promise<void>;
} {
  const [ml, setMl] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const rev = useDataRev("waterIntake");

  useEffect(() => {
    let cancelled = false;
    getWaterIntake(date)
      .then((row) => {
        if (cancelled) return;
        setMl(row?.ml ?? 0);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setMl(0);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [date, rev]);

  const add = useCallback(
    async (deltaMl: number) => {
      try {
        await addWater(date, deltaMl);
      } catch (err) {
        reportStorageError(err);
      }
    },
    [date],
  );

  const setTotal = useCallback(
    async (next: number) => {
      try {
        await setWaterTotal(date, next);
      } catch (err) {
        reportStorageError(err);
      }
    },
    [date],
  );

  return { ml, loaded, addWater: add, setTotal };
}
