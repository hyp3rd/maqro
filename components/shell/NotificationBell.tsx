"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { usePantryNotifications } from "@/hooks/use-pantry-notifications";
import type { PantryNotification } from "@/lib/db";
import { useState } from "react";
import { Bell, PackageOpen, X } from "lucide-react";
import type { ViewKey } from "./Sidebar";

type Props = {
  /** Forwarded from the topbar so a notification tap can switch the
   *  active view to the pantry. */
  onSelectView?: (key: ViewKey) => void;
};

/** Topbar notification bell + drawer. The unread count rides on a badge
 *  over the bell; opening the drawer marks everything read (the badge is
 *  an "unseen" signal, not a per-row to-do). Each row deep-links to the
 *  pantry view and offers a dismiss. Backed by the synced
 *  `pantryNotifications` store, so the badge stays live across the
 *  user's signed-in devices. */
export function NotificationBell({ onSelectView }: Props) {
  const { notifications, unreadCount, markAllRead, dismiss } =
    usePantryNotifications();
  const [open, setOpen] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Mark-all-read on open: the badge tracks "you haven't looked",
    // so the act of opening clears it. Fire-and-forget — a failed
    // write just leaves the badge up, which is harmless.
    if (next && unreadCount > 0) void markAllRead();
  }

  function handleView() {
    setOpen(false);
    onSelectView?.("pantry");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={handleOpenChange}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
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
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 pt-safe sm:max-w-sm">
        <SheetHeader className="border-b border-border/60 px-5 py-4 text-left">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>
            Low-stock alerts from your pantry.
          </SheetDescription>
        </SheetHeader>
        {notifications.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground">
            <PackageOpen className="h-8 w-8 opacity-50" />
            <p className="text-sm">You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul className="flex-1 divide-y divide-border/60 overflow-y-auto">
            {notifications.map((n) => (
              <NotificationRow
                key={n.id}
                notif={n}
                onView={handleView}
                onDismiss={() => void dismiss(n.id)}
              />
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NotificationRow({
  notif,
  onView,
  onDismiss,
}: {
  notif: PantryNotification;
  onView: () => void;
  onDismiss: () => void;
}) {
  const qty = `${notif.quantity} ${notif.unit}`.trim();
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <button
        type="button"
        onClick={onView}
        className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <p className="truncate text-sm font-medium text-foreground">
          {notif.itemName} is running low
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {qty} left · {relativeTime(notif.createdAt)}
        </p>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Dismiss ${notif.itemName} notification`}
        onClick={onDismiss}
        className="h-7 w-7 shrink-0 text-muted-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

/** Compact "x min/hr/day ago" using the platform's
 *  `Intl.RelativeTimeFormat`. Takes epoch ms (notification `createdAt`). */
function relativeTime(createdAt: number): string {
  const diffMs = createdAt - Date.now();
  const sec = Math.round(diffMs / 1000);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const min = Math.round(sec / 60);
  const hr = Math.round(sec / 3600);
  const day = Math.round(sec / 86400);
  if (Math.abs(sec) < 60) return fmt.format(sec, "second");
  if (Math.abs(min) < 60) return fmt.format(min, "minute");
  if (Math.abs(hr) < 24) return fmt.format(hr, "hour");
  return fmt.format(day, "day");
}
