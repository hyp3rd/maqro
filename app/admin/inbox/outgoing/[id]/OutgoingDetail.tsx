"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { clientFetch } from "@/lib/auth/client-fetch";
import type { OutgoingEmailStatus } from "@/lib/email/sending";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

/** Outgoing email detail. Pulls two things:
 *
 *    1. The local `admin_sent_emails` row (immutable, set at
 *       send-time) — authoritative for "who sent this, when".
 *
 *    2. The live Resend status — authoritative for delivery
 *       state (sent → delivered → opened, or bounced /
 *       complained / failed). May be `null` if Resend has
 *       garbage-collected the message or returns an error;
 *       page still renders the DB row in that case.
 *
 *  The Cancel button is only meaningful while Resend has the
 *  message in `scheduled` state. We render it as long as the
 *  local `scheduled_at` is in the future AND the live status
 *  is `scheduled`. Once the live status moves past that, the
 *  button hides (Resend rejects cancel on `queued` / `sent`
 *  rows anyway, and showing a no-op button is misleading). */

type DetailResponse = {
  row: {
    id: string;
    admin_user_id: string;
    recipients: string[];
    subject: string;
    in_reply_to: string | null;
    scheduled_at: string | null;
    created_at: string;
  };
  live: {
    id: string;
    from: string;
    to: string[];
    subject: string;
    lastStatus: OutgoingEmailStatus;
    createdAt: string;
    scheduledAt: string | null;
  } | null;
};

export function OutgoingDetail({ id }: { id: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; data: DetailResponse; fetchedAt: number }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void clientFetch(`/api/admin/inbox/outgoing/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setState({
            kind: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as DetailResponse;
        setState({ kind: "ok", data, fetchedAt: Date.now() });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Network error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  async function doCancel() {
    setCancelling(true);
    try {
      const res = await fetch(
        `/api/admin/inbox/outgoing/${encodeURIComponent(id)}/cancel`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Cancel failed (${res.status})`);
        return;
      }
      toast.success("Scheduled send cancelled.");
      setReloadKey((k) => k + 1);
    } finally {
      setCancelling(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300"
      >
        {state.message}
      </p>
    );
  }

  const { row, live } = state.data;
  const status = live?.lastStatus ?? null;
  // Whether the operator can still cancel. We anchor the "is it in
  // the future?" check to the timestamp the data was fetched at
  // (not Date.now() during render — calling that during render is
  // an impure-function rule violation, and re-evaluating every
  // render would also make the button flicker out unpredictably as
  // the schedule clock crosses). The Refresh button re-runs the
  // fetch, which updates the anchor. Resend's own cancel surface
  // is the canonical guard if the operator clicks late.
  const fetchedAt = state.fetchedAt;
  const isCancellable =
    row.scheduled_at !== null &&
    Date.parse(row.scheduled_at) > fetchedAt &&
    status === "scheduled";

  return (
    <article className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="space-y-2 border-b border-border/60 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-base font-semibold leading-snug sm:text-lg">
            {row.subject}
          </h1>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            title="Refresh live status"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          To:{" "}
          <span className="font-medium text-foreground">
            {row.recipients.join(", ")}
          </span>
        </p>
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Sent {formatTimestamp(row.created_at)}
          {row.scheduled_at && (
            <>
              {" · "}Scheduled {formatTimestamp(row.scheduled_at)}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {status ? (
            <StatusBadge status={status} />
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Live status unavailable
            </span>
          )}
          {row.in_reply_to && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Reply to inbound
            </span>
          )}
        </div>
      </header>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        <p className="text-xs text-muted-foreground">
          Body content isn&apos;t stored locally — Resend keeps the rendered
          message; we only persist the send metadata (recipients, subject,
          status). Use Resend&apos;s dashboard if you need to see the exact
          rendered email.
        </p>

        {isCancellable && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancelling}
                className="h-8 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
              >
                <XCircle className="h-3.5 w-3.5" />
                {cancelling ? "Cancelling…" : "Cancel scheduled send"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this scheduled send?</AlertDialogTitle>
                <AlertDialogDescription>
                  The message won&apos;t be delivered. The audit log keeps the
                  record either way.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancelling}>
                  Keep scheduled
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void doCancel();
                  }}
                  disabled={cancelling}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {cancelling ? "Cancelling…" : "Cancel send"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: OutgoingEmailStatus }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.unknown;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const STATUS_TONE: Record<OutgoingEmailStatus, string> = {
  scheduled:
    "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  queued: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
  sent: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
  delivered:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  delivery_delayed:
    "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  complained: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
  bounced: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
  opened:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  clicked:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
  canceled: "bg-muted text-muted-foreground ring-border",
  unknown: "bg-muted text-muted-foreground ring-border",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
