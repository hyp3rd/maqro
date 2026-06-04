"use client";

import {
  deleteFastSession,
  listFastSessions,
  type FastSession,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { notifyDataChanged, useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useState } from "react";

/** The archived fast history (newest first), read straight from IDB and
 *  re-read whenever the `fastSessions` data-bus revision bumps — i.e. when a
 *  fast is recorded (Stop / auto-finalize), deleted here, or pulled by sync.
 *  `sessions` is `null` until the first read resolves, so the caller can hold
 *  layout instead of flashing an empty state. Delete writes a tombstone (via
 *  `deleteFastSession`) so the removal propagates to the user's other devices. */
export function useFastSessions(): {
  sessions: FastSession[] | null;
  remove: (id: string) => Promise<void>;
} {
  const [sessions, setSessions] = useState<FastSession[] | null>(null);
  const rev = useDataRev("fastSessions");

  useEffect(() => {
    let cancelled = false;
    listFastSessions()
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteFastSession(id);
      notifyDataChanged("fastSessions");
      bumpPending();
    } catch (err) {
      reportStorageError(err);
    }
  }, []);

  return { sessions, remove };
}
