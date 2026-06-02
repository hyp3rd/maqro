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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientFetch } from "@/lib/auth/client-fetch";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Receipt,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

/** Settings → Billing → in-app management surface that replaces
 *  the most-common reasons users were bouncing to the Stripe
 *  Customer Portal:
 *
 *    - Next-charge preview ("Next charge: $X on YYYY-MM-DD").
 *    - Cancel-at-period-end / Resume toggle. We deliberately
 *      don't offer immediate cancellation - pro-rated refunds
 *      complicate accounting and at-period-end matches the
 *      Portal's own default.
 *    - Invoice history with hosted-page and PDF links per row.
 *
 *  Plan switching and payment-method updates still go to the
 *  Stripe Portal (mounted as the existing "Manage subscription"
 *  button in the parent BillingSection) - both are nuanced
 *  enough that re-implementing them in-app isn't worth the
 *  maintenance burden today.
 *
 *  This component fetches its data lazily on mount. It renders
 *  nothing when the user has no Stripe customer (the GET
 *  returns 404), so it's safe to mount unconditionally under
 *  BillingSection's premium branch. */

type SubscriptionState = {
  id: string;
  status: string;
  planLabel: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
};

type UpcomingState = {
  amount: number;
  currency: string;
  nextPaymentAttempt: number | null;
};

type InvoiceRow = {
  id: string;
  number: string | null;
  created: number;
  amountPaid: number;
  currency: string;
  status: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

type SubscriptionResponse = {
  subscription: SubscriptionState;
  upcoming: UpcomingState | null;
};

type InvoicesResponse = {
  rows: InvoiceRow[];
  hasMore: boolean;
  nextCursor: string | null;
};

type SubLoad =
  | { kind: "loading" }
  | { kind: "ok"; data: SubscriptionResponse }
  | { kind: "none" }
  | { kind: "error"; message: string };

type InvLoad =
  | { kind: "loading" }
  | {
      kind: "ok";
      rows: InvoiceRow[];
      hasMore: boolean;
      nextCursor: string | null;
    }
  | { kind: "error"; message: string };

function formatAmount(amountCents: number, currency: string): string {
  // Stripe amounts are in the currency's smallest unit. For most
  // currencies (USD, EUR, GBP) that's cents; for JPY and similar
  // zero-decimal currencies the whole-unit conversion is a no-op.
  // Defer the unit lookup to Intl.NumberFormat which knows the
  // right decimal count per ISO 4217 code.
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type InvoiceStatus = "all" | "paid" | "open" | "void" | "uncollectible";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  all: "All statuses",
  paid: "Paid",
  open: "Open",
  void: "Void",
  uncollectible: "Uncollectible",
};

export function BillingDetails() {
  const [subState, setSubState] = useState<SubLoad>({ kind: "loading" });
  const [invState, setInvState] = useState<InvLoad>({ kind: "loading" });
  const [cancelBusy, setCancelBusy] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [loadMoreBusy, setLoadMoreBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Filter state for the invoice list. Drives the `?status=`
  // param on the GET - server-side filtering keeps `hasMore`
  // accurate and avoids paging anomalies. Default `all` is the
  // common case (a user just wants to see their history).
  const [invStatus, setInvStatus] = useState<InvoiceStatus>("all");

  const refresh = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // No synchronous "loading" reset on refresh - for a refresh
    // after cancel/resume the user is better served by holding
    // the old data until the new fetch resolves (no jarring
    // "Loading…" flash). Initial mount still hits loading via
    // the useState initializer.
    void fetch("/api/billing/subscription")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setSubState({ kind: "none" });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setSubState({
            kind: "error",
            message: body.error ?? `Couldn't load subscription (${res.status})`,
          });
          return;
        }
        const data = (await res.json()) as SubscriptionResponse;
        setSubState({ kind: "ok", data });
      })
      .catch((err) => {
        if (cancelled) return;
        setSubState({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't load.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    // Same rationale as the subscription effect above - let the
    // table hold its existing rows during a refresh instead of
    // flashing back to "Loading…". `invStatus` is a dep so a
    // filter change re-runs the fetch with the new param.
    const qs = invStatus === "all" ? "" : `?status=${invStatus}`;
    void fetch(`/api/billing/invoices${qs}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setInvState({
            kind: "error",
            message: body.error ?? `Couldn't load invoices (${res.status})`,
          });
          return;
        }
        const data = (await res.json()) as InvoicesResponse;
        setInvState({
          kind: "ok",
          rows: data.rows,
          hasMore: data.hasMore,
          nextCursor: data.nextCursor,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setInvState({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't load.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, invStatus]);

  async function loadMoreInvoices() {
    if (invState.kind !== "ok" || !invState.nextCursor) return;
    setLoadMoreBusy(true);
    try {
      // Keep the current filter on the follow-up page so "Load
      // more" extends the filtered view rather than silently
      // jumping back to all-statuses.
      const params = new URLSearchParams({ cursor: invState.nextCursor });
      if (invStatus !== "all") params.set("status", invStatus);
      const res = await fetch(`/api/billing/invoices?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Couldn't load more invoices.");
        return;
      }
      const data = (await res.json()) as InvoicesResponse;
      setInvState((prev) =>
        prev.kind === "ok"
          ? {
              kind: "ok",
              rows: [...prev.rows, ...data.rows],
              hasMore: data.hasMore,
              nextCursor: data.nextCursor,
            }
          : prev,
      );
    } finally {
      setLoadMoreBusy(false);
    }
  }

  async function mutate(action: "cancel" | "resume") {
    const setBusy = action === "cancel" ? setCancelBusy : setResumeBusy;
    setBusy(true);
    try {
      const res = await clientFetch("/api/billing/subscription", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(
          body.error ??
            (action === "cancel" ? "Couldn't cancel." : "Couldn't resume."),
        );
        return;
      }
      toast.success(
        action === "cancel"
          ? "Cancellation scheduled - access continues until the end of the current period."
          : "Auto-renew restored.",
      );
      refresh();
    } finally {
      setBusy(false);
    }
  }

  // No Stripe customer at all (user never paid). Render nothing -
  // parent BillingSection's "Upgrade" CTA already handles the
  // first-payment path.
  if (subState.kind === "none") return null;

  return (
    <div className="space-y-4 border-t border-border/60 px-5 py-4">
      {subState.kind === "loading" ? (
        // Reserve the subscription panel's height so the invoices below
        // don't jump when the plan summary arrives.
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-3 w-44 animate-pulse rounded bg-muted/70" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        </div>
      ) : subState.kind === "error" ? (
        <p
          role="alert"
          className="text-xs text-red-600"
        >
          {subState.message}
        </p>
      ) : (
        <SubscriptionPanel
          sub={subState.data.subscription}
          upcoming={subState.data.upcoming}
          cancelBusy={cancelBusy}
          resumeBusy={resumeBusy}
          onCancel={() => void mutate("cancel")}
          onResume={() => void mutate("resume")}
        />
      )}

      <InvoicesPanel
        state={invState}
        status={invStatus}
        onStatusChange={setInvStatus}
        loadMoreBusy={loadMoreBusy}
        onLoadMore={() => void loadMoreInvoices()}
      />
    </div>
  );
}

function SubscriptionPanel({
  sub,
  upcoming,
  cancelBusy,
  resumeBusy,
  onCancel,
  onResume,
}: {
  sub: SubscriptionState;
  upcoming: UpcomingState | null;
  cancelBusy: boolean;
  resumeBusy: boolean;
  onCancel: () => void;
  onResume: () => void;
}) {
  // Cancel-at-period-end already set → the user has scheduled a
  // cancellation; show the "Resume" affordance instead of "Cancel".
  const isPendingCancel = sub.cancelAtPeriodEnd;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Plan</dt>
        <dd className="font-medium">{sub.planLabel}</dd>
        {upcoming ? (
          <>
            <dt className="text-muted-foreground">Next charge</dt>
            <dd className="font-mono tabular-nums">
              {formatAmount(upcoming.amount, upcoming.currency)}
              {upcoming.nextPaymentAttempt && (
                <span className="ml-1.5 text-muted-foreground">
                  on {formatTimestamp(upcoming.nextPaymentAttempt)}
                </span>
              )}
            </dd>
          </>
        ) : null}
        {isPendingCancel && (
          <>
            <dt className="text-muted-foreground">Cancels on</dt>
            <dd className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {new Date(sub.currentPeriodEnd).toLocaleDateString()}
            </dd>
          </>
        )}
      </dl>

      <div className="flex gap-2">
        {isPendingCancel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onResume}
            disabled={resumeBusy}
            className="h-8 gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {resumeBusy ? "Restoring…" : "Resume auto-renew"}
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancelBusy}
                className="h-8 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
                Cancel subscription
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
                <AlertDialogDescription>
                  You&apos;ll keep access until{" "}
                  {new Date(sub.currentPeriodEnd).toLocaleDateString()}, then
                  drop to the Free tier. No refund for the remaining days - to
                  match how the Stripe Portal handles cancellations.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancelBusy}>
                  Keep subscription
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    onCancel();
                  }}
                  disabled={cancelBusy}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {cancelBusy ? "Cancelling…" : "Cancel at period end"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

/** Maps a Stripe invoice status to a visual treatment: icon,
 *  tone class, and label. Kept inline rather than as a generic
 *  Badge component because (a) the set of statuses is small and
 *  stable and (b) the colour mapping is billing-specific. */
function statusPill(status: string | null): {
  label: string;
  className: string;
  icon: typeof CheckCircle2;
} {
  switch (status) {
    case "paid":
      return {
        label: "Paid",
        className:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
        icon: CheckCircle2,
      };
    case "open":
      return {
        label: "Open",
        className:
          "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
        icon: Receipt,
      };
    case "uncollectible":
      return {
        label: "Uncollectible",
        className:
          "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20",
        icon: XCircle,
      };
    case "void":
      return {
        label: "Void",
        className: "bg-muted text-muted-foreground ring-border/60",
        icon: XCircle,
      };
    default:
      return {
        label: status ?? "-",
        className: "bg-muted text-muted-foreground ring-border/60",
        icon: Receipt,
      };
  }
}

function InvoicesPanel({
  state,
  status,
  onStatusChange,
  loadMoreBusy,
  onLoadMore,
}: {
  state: InvLoad;
  status: InvoiceStatus;
  onStatusChange: (next: InvoiceStatus) => void;
  loadMoreBusy: boolean;
  onLoadMore: () => void;
}) {
  const rowCount = state.kind === "ok" ? state.rows.length : null;
  return (
    <div className="space-y-2">
      {/* Header: section title + count on the left, filter on the
       *  right. Aligns visually with the SubscriptionPanel's
       *  header pattern (label + action). */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" />
            Invoices
          </h4>
          {rowCount !== null && rowCount > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {rowCount}
              {state.kind === "ok" && state.hasMore ? "+" : ""}
            </span>
          )}
        </div>
        <Select
          value={status}
          onValueChange={(v) => onStatusChange(v as InvoiceStatus)}
        >
          <SelectTrigger className="h-7 w-[150px] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABELS) as InvoiceStatus[]).map((s) => (
              <SelectItem
                key={s}
                value={s}
                className="text-xs"
              >
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {state.kind === "loading" ? (
        <InvoiceSkeleton />
      ) : state.kind === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {state.message}
        </p>
      ) : state.rows.length === 0 ? (
        <EmptyInvoices status={status} />
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Invoice</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {state.rows.map((row) => {
                  const pill = statusPill(row.status);
                  const PillIcon = pill.icon;
                  return (
                    <tr
                      key={row.id}
                      className="transition-colors hover:bg-accent/30"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {formatTimestamp(row.created)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px]">
                        {row.number ?? (
                          <span className="text-muted-foreground">
                            {row.id.slice(0, 12)}…
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${pill.className}`}
                        >
                          <PillIcon className="h-3 w-3" />
                          {pill.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatAmount(row.amountPaid, row.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          {row.hostedInvoiceUrl && (
                            <a
                              href={row.hostedInvoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              title="View hosted invoice"
                            >
                              <ExternalLink className="h-3 w-3" />
                              View
                            </a>
                          )}
                          {row.invoicePdf && (
                            <a
                              href={row.invoicePdf}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              title="Download PDF"
                            >
                              <Download className="h-3 w-3" />
                              PDF
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {state.hasMore && (
            <div className="border-t border-border/60 px-3 py-2 text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onLoadMore}
                disabled={loadMoreBusy}
                className="h-7 gap-1.5 text-[11px] text-muted-foreground"
              >
                {loadMoreBusy ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InvoiceSkeleton() {
  // Mirrors the table shape so the layout doesn't pop when rows
  // arrive. Three rows is enough to read as "list" without
  // overcommitting screen real estate.
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card">
      <div className="border-b border-border/60 bg-muted/30 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      </div>
      <ul className="divide-y divide-border/60">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 px-3 py-3"
          >
            <div className="flex flex-1 items-center gap-3">
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
              <div className="h-4 w-14 animate-pulse rounded-full bg-muted/70" />
            </div>
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyInvoices({ status }: { status: InvoiceStatus }) {
  // Different copy for "you have nothing yet" vs "your filter is
  // too narrow" - the latter is recoverable by changing the
  // dropdown, the former is just the no-data state.
  const isFiltered = status !== "all";
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 bg-card px-4 py-10 text-center">
      <FileText className="h-6 w-6 text-muted-foreground/60" />
      <p className="text-xs text-muted-foreground">
        {isFiltered
          ? `No ${STATUS_LABELS[status].toLowerCase()} invoices to show.`
          : "No invoices yet."}
      </p>
      {isFiltered && (
        <p className="text-[10px] text-muted-foreground/70">
          Try a different status filter.
        </p>
      )}
    </div>
  );
}
