"use client";

import {
  deletePantryNotification,
  listPantryNotifications,
  setPantryNotificationRead,
  type PantryNotification,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { useCallback, useEffect, useState } from "react";

export type UsePantryNotifications = {
  notifications: PantryNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
};

/** Drawer data source for the topbar notification bell. Reads the
 *  synced `pantryNotifications` store and re-hydrates on every realtime
 *  arrival via `useDataRev` — the same pattern `PantryView` uses for
 *  its item list. Mutations write through the IDB CRUD helpers, call
 *  `bumpPending()` so the sync pill reflects the unsynced edit, then
 *  refresh local state directly (IDB writes don't notify the bus). */
export function usePantryNotifications(): UsePantryNotifications {
  const [notifications, setNotifications] = useState<PantryNotification[]>([]);
  const rev = useDataRev("pantryNotifications");

  useEffect(() => {
    let cancelled = false;
    listPantryNotifications()
      .then((rows) => {
        if (!cancelled) setNotifications(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setNotifications([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  const refresh = useCallback(async () => {
    try {
      setNotifications(await listPantryNotifications());
    } catch (err) {
      reportStorageError(err);
      setNotifications([]);
    }
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      await setPantryNotificationRead(id, true);
      bumpPending();
      await refresh();
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    for (const n of unread) {
      await setPantryNotificationRead(n.id, true);
    }
    bumpPending();
    await refresh();
  }, [notifications, refresh]);

  const dismiss = useCallback(
    async (id: string) => {
      await deletePantryNotification(id);
      bumpPending();
      await refresh();
    },
    [refresh],
  );

  const unreadCount = notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0);

  return { notifications, unreadCount, markRead, markAllRead, dismiss };
}
