"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PantryNotification } from "@/lib/db";
import { PackageOpen, X } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: PantryNotification[];
  /** Deep-link a row to the pantry view (closes the drawer first). */
  onView: () => void;
  onDismiss: (id: string) => void;
};

/** Controlled, trigger-less notifications drawer. The trigger and the
 *  unread badge live with the caller (the desktop bell, or the mobile
 *  avatar menu); this component is purely the drawer body so both entry
 *  points render the exact same list. Data is passed in — the caller
 *  owns the single `usePantryNotifications` instance so its badge and
 *  this list never drift. */
export function NotificationsSheet({
  open,
  onOpenChange,
  notifications,
  onView,
  onDismiss,
}: Props) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
    >
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
                onView={onView}
                onDismiss={() => onDismiss(n.id)}
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
