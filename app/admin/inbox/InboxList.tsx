"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientFetch } from "@/lib/auth/client-fetch";
import type { ReceivedEmailSummary } from "@/lib/email/receiving";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { Archive, Paperclip, PenSquare, Search } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { ComposeEmailDialog } from "./ComposeEmailDialog";

/** Client-side filterable list of received emails. Renders as
 *  responsive cards: full-width with a touch-friendly tap target on
 *  mobile, denser two-column-feeling layout on desktop. Each card
 *  is a Link to /admin/inbox/[id] so middle-click / cmd-click /
 *  "open in new tab" all work natively without our own handler. */
export function InboxList({ emails }: { emails: ReceivedEmailSummary[] }) {
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  // Local copy so archiving removes a row immediately; the server already
  // filters dismissed messages out on the next full load.
  const [items, setItems] = useState(emails);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (e) =>
        e.from.toLowerCase().includes(q) ||
        e.to.some((t) => t.toLowerCase().includes(q)) ||
        e.subject.toLowerCase().includes(q) ||
        e.snippet.toLowerCase().includes(q),
    );
  }, [items, query]);

  const archive = async (id: string) => {
    setItems((prev) => prev.filter((e) => e.id !== id));
    try {
      const res = await clientFetch(
        `/api/admin/inbox/${encodeURIComponent(id)}/dismiss`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Archived.");
    } catch {
      toast.error("Couldn't archive — it may reappear on reload.");
    }
  };

  // Even with no inbound mail the operator should still be able
  // to compose — the Compose dialog isn't gated on having received
  // a message. Render an empty-state with the button rather than
  // bailing entirely.
  if (items.length === 0) {
    return (
      <>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => setComposeOpen(true)}
            className="gap-1.5"
          >
            <PenSquare className="h-3.5 w-3.5" />
            Compose
          </Button>
        </div>
        <ComposeEmailDialog
          open={composeOpen}
          onOpenChange={setComposeOpen}
        />
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sender, recipient, subject, or body"
            className="pl-8 text-sm"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setComposeOpen(true)}
          className="gap-1.5"
        >
          <PenSquare className="h-3.5 w-3.5" />
          Compose
        </Button>
      </div>
      <ComposeEmailDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
      />
      {filtered.length === 0 ? (
        <p className="rounded-md border border-border/60 bg-card px-4 py-6 text-center text-xs text-muted-foreground">
          No messages match &quot;{query}&quot;.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
          {filtered.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              onArchive={archive}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailRow({
  email,
  onArchive,
}: {
  email: ReceivedEmailSummary;
  onArchive: (id: string) => void;
}) {
  const initial = (email.from.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  return (
    <li className="flex items-stretch">
      <Link
        href={`/admin/inbox/${encodeURIComponent(email.id)}`}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-3 px-3 py-3 transition-colors hover:bg-accent/40 sm:px-4 sm:py-3.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/90 text-[12px] font-semibold text-background sm:h-10 sm:w-10"
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{email.from}</p>
            <time
              dateTime={email.createdAt}
              className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              {formatRelative(email.createdAt)}
            </time>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-foreground/85">
            {email.hasAttachments && (
              <Paperclip
                className="h-3 w-3 shrink-0 text-muted-foreground"
                aria-label="Has attachments"
              />
            )}
            <span className="truncate font-medium">{email.subject}</span>
          </p>
          {email.snippet && (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {email.snippet}
            </p>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onArchive(email.id)}
        aria-label="Archive (hide from inbox)"
        title="Archive (hide from inbox)"
        className="flex shrink-0 items-center px-3 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Archive className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Relative-time formatter sized for the row's tight metadata
 *  column. "5m / 2h / 3d / May 12" — enough resolution for an
 *  inbox glance without burning visual space. */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
