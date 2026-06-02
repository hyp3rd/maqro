"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNotificationDrawer } from "@/hooks/use-notification-drawer";
import { Bell } from "lucide-react";
import { NotificationsSheet } from "./NotificationsSheet";
import type { ViewKey } from "./Sidebar";

type Props = {
  /** Forwarded from the topbar so a notification tap can switch the
   *  active view to the pantry. */
  onSelectView?: (key: ViewKey) => void;
};

/** Topbar notification bell + drawer (desktop). The unread count rides on
 *  a badge over the bell; opening the drawer marks everything read (the
 *  badge is an "unseen" signal, not a per-row to-do). On mobile this lives
 *  inside the avatar menu instead — see UserMenu — so both share the
 *  `useNotificationDrawer` wiring and the `NotificationsSheet` body. */
export function NotificationBell({ onSelectView }: Props) {
  const {
    open,
    setOpen,
    openDrawer,
    unreadCount,
    notifications,
    onView,
    onDismiss,
  } = useNotificationDrawer(onSelectView);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={openDrawer}
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
        title="Notifications"
        className="relative h-8 w-8"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 py-0 text-[10px] leading-none"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </Button>
      <NotificationsSheet
        open={open}
        onOpenChange={setOpen}
        notifications={notifications}
        onView={onView}
        onDismiss={onDismiss}
      />
    </>
  );
}
