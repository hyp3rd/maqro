"use client";

import { type BodyMeasurement, listBodyMeasurements } from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useMemo, useState } from "react";
import { latestBodyFatPct } from "@maqro/core/body-fat";
import type { PersonalInfo } from "@maqro/core/types";

/** The body-fat % the app's targets read (`TargetContext.bodyFatPct`):
 *  `latestBodyFatPct` over this device's body measurements, the same
 *  derivation /report and the crons use. Re-reads when a measurement is
 *  saved, deleted or synced in (the `bodyMeasurements` data-bus rev).
 *
 *  `null` until the store has loaded, with no usable measurement, or when
 *  the store can't be read (reported like every other storage failure). */
export function useLatestBodyFatPct(
  profile: Pick<PersonalInfo, "gender" | "height">,
): number | null {
  const rev = useDataRev("bodyMeasurements");
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);

  useEffect(() => {
    let cancelled = false;
    listBodyMeasurements()
      .then((rows) => {
        if (!cancelled) setMeasurements(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) reportStorageError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  return useMemo(
    () =>
      latestBodyFatPct(measurements, {
        gender: profile.gender,
        heightCm: profile.height,
      }),
    [measurements, profile.gender, profile.height],
  );
}
