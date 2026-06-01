"use client";

import { AdminPagination } from "@/components/admin/AdminPagination";
import { CodeBlock } from "@/components/admin/CodeBlock";
import { CopyableId } from "@/components/admin/CopyableId";
import { EmptyState } from "@/components/admin/EmptyState";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pill } from "@/components/admin/Pill";
import { Button } from "@/components/ui/button";
import { clientFetch } from "@/lib/auth/client-fetch";
import * as React from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Webhook,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

/** Admin viewer for Stripe webhook events.
 *
 *  Three things this page exists to do:
 *
 *    1. **Status visibility** - at a glance, which events succeeded,
 *       which failed, which are still pending. Failure is the alert-
 *       worthy state, so the default range covers a week.
 *    2. **Payload inspection** - clicking a row fetches the full row
 *       (incl. the stored `payload` JSON) so the operator can read
 *       what Stripe actually sent. Without this, debugging a
 *       webhook-handler regression means tailing Stripe's dashboard.
 *    3. **Manual replay** - re-runs the dispatcher against a stored
 *       payload. The common use case is "we deployed a fix, replay
 *       the failed event from yesterday." The replay endpoint
 *       writes an `admin_audit_log` row each time so the trail is
 *       intact. */

type ListRow = {
  id: string;
  type: string;
  created_at: string;
  processed_at: string | null;
  processing_status: "success" | "error" | null;
  processing_error: string | null;
  replayed_at: string | null;
};

type ListResponse = {
  rows: ListRow[];
  total: number;
  status: string;
  since: string;
  page: number;
  per: number;
};

type DetailRow = ListRow & {
  payload: Record<string, unknown> | null;
  replayed_by: string | null;
};

type StatusFilter = "all" | "success" | "error" | "pending";
type RangeFilter = "1h" | "24h" | "7d" | "30d" | "all";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  success: "Success",
  error: "Errors",
  pending: "Pending",
};

const RANGE_LABELS: Record<RangeFilter, string> = {
  "1h": "Last hour",
  "24h": "Last 24h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

const PER_PAGE = 25;

export default function AdminWebhooksPage() {
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [range, setRange] = React.useState<RangeFilter>("7d");
  const [page, setPage] = React.useState(1);
  const [tick, setTick] = React.useState(0);
  const [listState, setListState] = React.useState<
    | { kind: "loading" }
    | { kind: "ok"; data: ListResponse }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; row: DetailRow }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [replayBusy, setReplayBusy] = React.useState(false);

  // Reset list / detail state to "loading" / "idle" *during render*
  // when their inputs change. This is the project's sanctioned
  // pattern for the `react-hooks/set-state-in-effect` rule - the
  // setState call runs before the effect, so cascading renders are
  // bounded and predictable.
  const filterKey = `${status}|${range}|${page}|${tick}`;
  const [prevFilterKey, setPrevFilterKey] = React.useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setListState({ kind: "loading" });
  }
  const [prevSelectedId, setPrevSelectedId] = React.useState(selectedId);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    setDetail(selectedId ? { kind: "loading" } : { kind: "idle" });
  }

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      status,
      since: range,
      page: String(page),
      per: String(PER_PAGE),
    });
    clientFetch(`/api/admin/webhooks?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setListState({
            kind: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const json = (await res.json()) as ListResponse;
        setListState({ kind: "ok", data: json });
      })
      .catch((err) => {
        if (cancelled) return;
        setListState({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [status, range, page, tick]);

  // Detail fetch is independent of the list - fires whenever the
  // selection changes. Keeps the list response small (no payload)
  // and the detail response heavy only when actually asked for.
  // Loading/idle state transitions are handled by the prop-change
  // pattern above; this effect only owns the fetch itself.
  React.useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    clientFetch(`/api/admin/webhooks/${selectedId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setDetail({
            kind: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const json = (await res.json()) as { row: DetailRow };
        setDetail({ kind: "ok", row: json.row });
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function replay(id: string) {
    setReplayBusy(true);
    try {
      const res = await clientFetch(`/api/admin/webhooks/${id}/replay`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };
      if (!res.ok || body.status === "error") {
        toast.error(body.error ?? `Replay failed (${res.status}).`);
      } else {
        toast.success("Replayed.");
      }
      // Re-fetch list and detail to reflect the new status.
      setTick((t) => t + 1);
      setSelectedId(id);
      setDetail({ kind: "loading" });
    } finally {
      setReplayBusy(false);
    }
  }

  const list = listState.kind === "ok" ? listState.data : null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Webhook}
        title="Stripe webhooks"
        description="Every event Stripe has delivered, with the dispatch outcome and a replay action for previously-failed events."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTick((t) => t + 1)}
            className="h-8"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          label="Status"
          options={Object.keys(STATUS_LABELS) as StatusFilter[]}
          current={status}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          labels={STATUS_LABELS}
        />
        <FilterGroup
          label="Range"
          options={Object.keys(RANGE_LABELS) as RangeFilter[]}
          current={range}
          onChange={(next) => {
            setRange(next);
            setPage(1);
          }}
          labels={RANGE_LABELS}
        />
        {listState.kind === "ok" && (
          <p className="text-[11px] tabular-nums text-muted-foreground sm:ml-auto">
            {listState.data.total.toLocaleString()}{" "}
            {listState.data.total === 1 ? "row" : "rows"}
          </p>
        )}
      </div>

      {listState.kind === "error" && (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {listState.message}
        </p>
      )}

      {/* `min-w-0` on every grid child is load-bearing: without
          it a grid child sizes to its content's natural width,
          and the JSON payload in the detail panel is wider than
          a phone viewport. Result was the Open-in-Stripe button
          getting clipped off the right edge. */}
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card">
          {listState.kind === "loading" ? (
            <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </p>
          ) : !list || list.rows.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title={
                status !== "all" || range !== "7d"
                  ? "No matching webhook events"
                  : "No webhook events"
              }
              description={
                status !== "all" || range !== "7d"
                  ? "Try a different status or widen the range."
                  : "Stripe events processed by this deployment will show up here."
              }
              action={
                status !== "all" || range !== "7d" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStatus("all");
                      setRange("7d");
                      setPage(1);
                    }}
                  >
                    Reset filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {list.rows.map((row) => {
                const isSelected = selectedId === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/30 ${
                        isSelected ? "bg-accent/40" : ""
                      }`}
                    >
                      <StatusIcon status={row.processing_status} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {row.type}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {row.id} · {new Date(row.created_at).toLocaleString()}
                          {row.replayed_at && " · replayed"}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list && list.rows.length > 0 && (
            <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-[11px] tabular-nums text-muted-foreground">
              <span>
                Showing {(list.page - 1) * list.per + 1}–
                {Math.min(list.page * list.per, list.total)} of{" "}
                {list.total.toLocaleString()}
              </span>
              <AdminPagination
                page={list.page}
                totalPages={Math.max(1, Math.ceil(list.total / list.per))}
                onPageChange={setPage}
              />
            </footer>
          )}
        </div>

        <aside className="min-w-0 rounded-lg border border-border/60 bg-card p-4 lg:sticky lg:top-20 lg:self-start">
          {detail.kind === "idle" ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Select an event to inspect its payload or replay it.
            </p>
          ) : detail.kind === "loading" ? (
            <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading payload…
            </p>
          ) : detail.kind === "error" ? (
            <p
              role="alert"
              className="text-xs text-red-600"
            >
              {detail.message}
            </p>
          ) : (
            <DetailPanel
              row={detail.row}
              busy={replayBusy}
              onReplay={() => replay(detail.row.id)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ListRow["processing_status"] }) {
  if (status === "success") {
    return (
      <CheckCircle2
        aria-label="Success"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
      />
    );
  }
  if (status === "error") {
    return (
      <XCircle
        aria-label="Error"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400"
      />
    );
  }
  return (
    <span
      aria-label="Pending"
      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
    />
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  current,
  onChange,
  labels,
}: {
  label: string;
  options: readonly T[];
  current: T;
  onChange: (next: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={current === opt}
            // `whitespace-nowrap` — multi-word labels like
            // "Last 7 days" used to wrap inside a 28 px chip and
            // overflow the rounded border. Single-line + outer
            // flex-wrap is the right combination.
            className={`h-7 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
              current === opt
                ? "border-foreground/40 bg-foreground text-background"
                : "border-border/60 bg-background text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            {labels[opt]}
          </button>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({
  row,
  busy,
  onReplay,
}: {
  row: DetailRow;
  busy: boolean;
  onReplay: () => void;
}) {
  // Replay is gated on payload presence - events recorded before
  // migration 0027 have no payload and can't be re-dispatched.
  const canReplay = row.payload != null;
  // The Stripe dashboard has the canonical view of every event;
  // a direct deep-link saves the operator one search. Stripe
  // event ids are stable across test/live, so we build the URL
  // off the id alone - works for both test and live mode.
  const stripeUrl = `https://dashboard.stripe.com/events/${row.id}`;
  return (
    <div className="space-y-3 text-xs">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={statusTone(row.processing_status)}>
            {row.processing_status ?? "pending"}
          </Pill>
          {row.replayed_at && <Pill tone="amber">replayed</Pill>}
        </div>
        <p className="break-words font-mono text-sm font-medium">{row.type}</p>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>Event id</span>
          <CopyableId
            value={row.id}
            display={row.id}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <WebhookField
          label="Received"
          value={new Date(row.created_at).toLocaleString()}
        />
        <WebhookField
          label="Processed"
          value={
            row.processed_at ? new Date(row.processed_at).toLocaleString() : "-"
          }
        />
        {row.replayed_at && (
          <WebhookField
            label="Last replayed"
            value={new Date(row.replayed_at).toLocaleString()}
            wrap
          />
        )}
      </dl>

      {row.processing_error && (
        <CodeBlock
          label="Processing error"
          copy={row.processing_error}
          maxHeight={160}
        >
          {row.processing_error}
        </CodeBlock>
      )}

      {row.payload && (
        <JsonViewer
          label="Payload"
          value={row.payload}
        />
      )}

      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <Button
          type="button"
          size="sm"
          onClick={onReplay}
          disabled={!canReplay || busy}
          className="w-full"
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" />
          )}
          {canReplay
            ? busy
              ? "Replaying…"
              : "Replay event"
            : "Replay unavailable (no stored payload)"}
        </Button>
        <a
          href={stripeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          Open in Stripe dashboard
        </a>
      </div>
    </div>
  );
}

function statusTone(
  status: ListRow["processing_status"],
): "emerald" | "red" | "muted" {
  if (status === "success") return "emerald";
  if (status === "error") return "red";
  return "muted";
}

function WebhookField({
  label,
  value,
  wrap,
}: {
  label: string;
  value: string;
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-mono text-[11px]">{value}</dd>
    </div>
  );
}
