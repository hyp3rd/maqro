"use client";

import { cn } from "@/lib/utils";
import { Inbox as InboxIcon, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tab strip linking the inbound (`/admin/inbox`) and outbound
 *  (`/admin/inbox/outgoing`) inbox surfaces. Rendered on each
 *  surface so the operator can flip without going through the
 *  AdminNav menu.
 *
 *  Active match is prefix-style at the segment level — the
 *  outbound detail page (`/admin/inbox/outgoing/em_abc`) still
 *  highlights "Outgoing", and the inbound detail page
 *  (`/admin/inbox/em_abc`) still highlights "Inbox". */
export function InboxTabs() {
  const pathname = usePathname();
  // Outgoing is the more-specific prefix; check it first so the
  // inbound match below doesn't claim outbound pages.
  const onOutgoing =
    pathname === "/admin/inbox/outgoing" ||
    pathname.startsWith("/admin/inbox/outgoing/");
  const onInbox = !onOutgoing;

  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5 text-xs"
      role="tablist"
      aria-label="Inbox view"
    >
      <Tab
        href="/admin/inbox"
        active={onInbox}
        icon={InboxIcon}
        label="Inbox"
      />
      <Tab
        href="/admin/inbox/outgoing"
        active={onOutgoing}
        icon={Send}
        label="Outgoing"
      />
    </div>
  );
}

function Tab({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: typeof InboxIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Link>
  );
}
