"use client";

import type { PersonalInfo } from "@/components/macro/types";
import { useNow } from "@/hooks/use-now";
import {
  getProfile,
  listDailyLogs,
  saveFastSession,
  saveProfile,
  type DailyLog,
} from "@/lib/db";
import {
  buildFastSessionInput,
  computeFastStatus,
  protocolHours,
  type FastingConfig,
  type FastStatus,
} from "@/lib/fasting";
import { notifyProfileChanged } from "@/lib/profile-bus";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { notifyDataChanged, useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Live intermittent-fasting status + mutators, usable from ANY surface
 *  (the day-view card AND the Topbar chip, which sits outside
 *  macro-calculator and so can't reach `patchProfile`). Reads the profile +
 *  daily logs straight from IDB, re-reading on the `profile`/`dailyLogs`
 *  data-bus revisions, and ticks every minute via `useNow()`.
 *
 *  Mutators write the profile through the standalone path
 *  (`getProfile` → `saveProfile` → notify): the `notifyDataChanged("profile")`
 *  is load-bearing — it re-loads macro-calculator's `useProfile` and feeds
 *  the sync layer, so the in-app state and the chip never diverge. */
export function useFastingStatus(): {
  status: FastStatus;
  fasting: PersonalInfo["fasting"];
  fastingHours: number;
  /** The user's full daily-log history (already loaded for the status math)
   *  — exposed so the Fasting page can compute the per-streak phase
   *  breakdown without a second IDB read. */
  logs: DailyLog[];
  isHydrated: boolean;
  /** Begin a fast now (archiving any fast left running, e.g. one replaced
   *  without Stop during the open eating window). */
  startFast: () => Promise<void>;
  /** End the current fast (back to not-fasting), archiving it to history. */
  stopFast: () => Promise<void>;
  /** Turn fasting tracking off entirely — archives a running fast first. */
  disableFasting: () => Promise<void>;
  /** Set the fast's start time to a specific instant (the edit affordance). */
  setFastStart: (ms: number) => Promise<void>;
  updateFasting: (patch: Partial<FastingConfig>) => Promise<void>;
} {
  const [profile, setProfile] = useState<PersonalInfo | null>(null);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const profileRev = useDataRev("profile");
  const logsRev = useDataRev("dailyLogs");
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProfile(), listDailyLogs()])
      .then(([p, l]) => {
        if (cancelled) return;
        setProfile(p);
        setLogs(l);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setProfile(null);
        setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profileRev, logsRev]);

  const fasting = profile?.fasting;
  const fastingHours = protocolHours(fasting);
  const fastStartedAt = fasting?.fastStartedAt ?? null;

  const status = useMemo<FastStatus>(
    () => computeFastStatus({ fastStartedAt, fastingHours, now }),
    [now, fastStartedAt, fastingHours],
  );

  const writeFasting = useCallback(async (patch: Partial<FastingConfig>) => {
    try {
      const p = await getProfile();
      if (!p) return;
      const nextFasting: FastingConfig = {
        enabled: false,
        protocol: "16:8",
        ...(p.fasting ?? {}),
        ...patch,
      };
      await saveProfile({ ...p, fasting: nextFasting });
      notifyProfileChanged();
      notifyDataChanged("profile");
      bumpPending();
    } catch (err) {
      reportStorageError(err);
    }
  }, []);

  /** Archive the currently-running fast (if any) as a completed session,
   *  ending at `endedAt`. No-op when no fast is running or the span is below
   *  the record threshold. Notifies the `fastSessions` bus so history
   *  re-loads. Reads the profile fresh so it always finalizes the fast that
   *  is *actually* running, not a stale render snapshot. */
  const recordFastEnd = useCallback(async (endedAt: number) => {
    try {
      const p = await getProfile();
      const input = buildFastSessionInput(p?.fasting, endedAt);
      if (!input) return;
      await saveFastSession(input);
      notifyDataChanged("fastSessions");
      bumpPending();
    } catch (err) {
      reportStorageError(err);
    }
  }, []);

  const startFast = useCallback(async () => {
    // Archive a fast the user replaced without tapping Stop — e.g. tapping
    // "Start fast now" again during the open eating window, which would
    // otherwise overwrite (and lose) the fast that just completed.
    const now = Date.now();
    await recordFastEnd(now);
    await writeFasting({ enabled: true, fastStartedAt: now });
  }, [recordFastEnd, writeFasting]);
  const stopFast = useCallback(async () => {
    await recordFastEnd(Date.now());
    await writeFasting({ fastStartedAt: null });
  }, [recordFastEnd, writeFasting]);
  const disableFasting = useCallback(async () => {
    // Turning tracking off ends any running fast: archive it and clear the
    // start so re-enabling later doesn't resurrect a stale, days-old fast.
    await recordFastEnd(Date.now());
    await writeFasting({ enabled: false, fastStartedAt: null });
  }, [recordFastEnd, writeFasting]);
  // Editing the start time adjusts the *same* ongoing fast — deliberately no
  // record here (the fast hasn't ended).
  const setFastStart = useCallback(
    (ms: number) => writeFasting({ enabled: true, fastStartedAt: ms }),
    [writeFasting],
  );

  return {
    status,
    fasting,
    fastingHours,
    logs,
    isHydrated: profile !== null,
    startFast,
    stopFast,
    disableFasting,
    setFastStart,
    updateFasting: writeFasting,
  };
}
