"use client";

import type { ViewKey } from "@/components/shell/Sidebar";
import { usePantryNotifications } from "@/hooks/use-pantry-notifications";
import type { PantryNotification } from "@/lib/db";
import { useCallback, useState } from "react";

export type NotificationDrawer = {
  open: boolean;
  /** Sheet `onOpenChange` — wire to dismissals (Escape / overlay). */
  setOpen: (open: boolean) => void;
  /** Open the drawer and clear the unread badge (the badge means
   *  "unseen", so viewing the list clears it). */
  openDrawer: () => void;
  unreadCount: number;
  notifications: PantryNotification[];
  /** Row deep-link: close the drawer, then switch to the pantry view. */
  onView: () => void;
  onDismiss: (id: string) => void;
};

/** Shared wiring for every entry point into the pantry notifications
 *  drawer (the desktop topbar bell and the mobile avatar menu). Owns a
 *  single `usePantryNotifications` instance plus the open state, so the
 *  trigger's badge and the drawer list stay consistent and the
 *  mark-all-read-on-open behavior lives in exactly one place. */
export function useNotificationDrawer(
  onSelectView?: (key: ViewKey) => void,
): NotificationDrawer {
  const { notifications, unreadCount, markAllRead, dismiss } =
    usePantryNotifications();
  const [open, setOpen] = useState(false);

  const openDrawer = useCallback(() => {
    setOpen(true);
    // Fire-and-forget: a failed write just leaves the badge up, which is
    // harmless.
    if (unreadCount > 0) void markAllRead();
  }, [unreadCount, markAllRead]);

  const onView = useCallback(() => {
    setOpen(false);
    onSelectView?.("pantry");
  }, [onSelectView]);

  const onDismiss = useCallback((id: string) => void dismiss(id), [dismiss]);

  return {
    open,
    setOpen,
    openDrawer,
    unreadCount,
    notifications,
    onView,
    onDismiss,
  };
}
