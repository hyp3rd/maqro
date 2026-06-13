"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";
import { ArrowRight, LogIn, Menu } from "lucide-react";
import Link from "next/link";

type NavLink = { href: string; label: string };

/** Mobile-only nav drawer for the marketing header.
 *
 *  On phones the section anchors (Features / Pricing / FAQ) were `sm:`-gated
 *  out of the header and had no replacement — a visitor on a phone literally
 *  could not jump to them. The hamburger opens a right-side Sheet that lists
 *  them and carries the auth CTAs, so "Sign in" can move off the cramped
 *  mobile bar (it stays visible at sm+). Reuses the shared Sheet primitive,
 *  which already handles the overlay, focus trap, safe-area, and Escape. */
export function MobileNavDrawer({
  sections,
  signedIn,
  labels,
}: {
  /** In-page anchors (#features, …). */
  sections: NavLink[];
  signedIn: boolean;
  labels: { menu: string; signIn: string; openApp: string };
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const row =
    "flex items-center justify-between rounded-md px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent active:bg-muted";

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={labels.menu}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground coarse:h-11 coarse:w-11 sm:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-72 flex-col gap-0"
      >
        <SheetHeader className="text-left">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>

        <nav className="mt-6 flex flex-col">
          {sections.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={close}
              className={row}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pb-safe pt-6">
          {!signedIn && (
            <Link
              href="/login"
              onClick={close}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border/60 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <LogIn className="h-4 w-4" />
              {labels.signIn}
            </Link>
          )}
          <Link
            href="/app"
            onClick={close}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            {labels.openApp}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
