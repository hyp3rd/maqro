"use client";

import { AdminPagination } from "@/components/admin/AdminPagination";
import { CodeBlock } from "@/components/admin/CodeBlock";
import { EmptyState } from "@/components/admin/EmptyState";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pill } from "@/components/admin/Pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientFetch } from "@/lib/auth/client-fetch";
import * as React from "react";
import {
  AlertTriangle,
  FlaskConical,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import Link from "next/link";

type ErrorRow = {
  id: string;
  created_at: string;
  app_version: string | null;
  route: string | null;
  level: "error" | "warning";
  message: string;
  stack: string | null;
  user_agent: string | null;
  session_token: string | null;
  context: Record<string, unknown> | null;
};

type ListResponse = {
  rows: ErrorRow[];
  total: number;
  level: string;
  since: string;
  q: string;
  page: number;
  per: number;
};

type LevelFilter = "error" | "warning" | "all";
type RangeFilter = "1h" | "24h" | "7d" | "30d" | "all";

const RANGE_LABELS: Record<RangeFilter, string> = {
  "1h": "Last hour",
  "24h": "Last 24h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

const LEVEL_LABELS: Record<LevelFilter, string> = {
  error: "Errors",
  warning: "Warnings",
  all: "All",
};

const PER_PAGE = 25;

export default function AdminErrorsPage() {
  const [level, setLevel] = React.useState<LevelFilter>("error");
  const [range, setRange] = React.useState<RangeFilter>("24h");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [tick, setTick] = React.useState(0);
  // Discriminated-union state mirrors the pattern in
  // /admin/users - single setState per branch so the
  // react-hooks/set-state-in-effect rule stays happy.
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "ok"; data: ListResponse }
    | { status: "error"; message: string }
  >({ status: "loading" });
  // Selected row id for the detail drawer (right-side panel).
  const [selected, setSelected] = React.useState<string | null>(null);
  // Pipeline diagnostic: POST a known event straight to /api/errors and
  // surface the exact response, so "nothing is logging" can be pinned to
  // a layer instead of guessed. `{ok:true}` = pipeline healthy (so the
  // real cause is errors not being *captured*); `{skipped:true}` =
  // SUPABASE_SECRET_KEY missing or kill-switch on; 500 = insert failing.
  const [testState, setTestState] = React.useState<
    | { status: "idle" }
    | { status: "sending" }
    | { status: "done"; ok: boolean; detail: string }
  >({ status: "idle" });

  async function sendTestEvent() {
    setTestState({ status: "sending" });
    try {
      const res = await fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_version: "admin-test",
          route: "admin:pipeline-test",
          level: "warning",
          message: `Admin pipeline test — ${new Date().toISOString()}`,
          context: { source: "admin-errors-page" },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        skipped?: boolean;
        error?: string;
      };
      const detail = body.skipped
        ? "Route returned skipped: SUPABASE_SECRET_KEY missing or ERROR_LOG_DISABLED is set — nothing was written."
        : body.ok
          ? "Inserted. The pipeline works — if real errors still don't appear, they aren't being captured client-side. Refresh to see the test row."
          : `HTTP ${res.status}: ${body.error ?? "insert failed (check Vercel function logs)"}`;
      setTestState({ status: "done", ok: Boolean(body.ok), detail });
      if (body.ok) setTick((t) => t + 1);
    } catch (err) {
      setTestState({
        status: "done",
        ok: false,
        detail: `Request failed: ${
          err instanceof Error ? err.message : "network error"
        }`,
      });
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      level,
      since: range,
      page: String(page),
      per: String(PER_PAGE),
    });
    if (q.trim()) params.set("q", q.trim());
    clientFetch(`/api/admin/errors?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setState({
            status: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const json = (await res.json()) as ListResponse;
        setState({ status: "ok", data: json });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [level, range, q, page, tick]);

  const data = state.status === "ok" ? state.data : null;
  const loading = state.status === "loading";
  const error = state.status === "error" ? state.message : null;
  const selectedRow = data?.rows.find((r) => r.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={AlertTriangle}
        title="Error log"
        description="Privacy-stripped client + server errors. Session-rotated tokens correlate within a tab; no user IDs, no emails."
        tone="amber"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void sendTestEvent()}
              disabled={testState.status === "sending"}
              className="h-8"
            >
              {testState.status === "sending" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send test event
            </Button>
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
          </div>
        }
      />

      {testState.status === "done" && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-xs ${
            testState.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200"
          }`}
        >
          {testState.detail}
        </div>
      )}

      {/* Filter pills - level + range. Click toggles within each
          group; the request fires from the effect. Search runs
          against `message` server-side; changing it resets to
          page 1 so the new result set isn't misaligned with the
          old cursor. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search message…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>
        <FilterGroup
          label="Level"
          options={Object.keys(LEVEL_LABELS) as LevelFilter[]}
          current={level}
          onChange={(next) => {
            setLevel(next);
            setPage(1);
          }}
          labels={LEVEL_LABELS}
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
        {data && (
          <p className="text-[11px] tabular-nums text-muted-foreground sm:ml-auto">
            {data.total.toLocaleString()} {data.total === 1 ? "row" : "rows"}
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* List */}
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </p>
          ) : !data || data.rows.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title={
                q || level !== "error" || range !== "24h"
                  ? "No matching events"
                  : "No errors in this window"
              }
              description={
                q || level !== "error" || range !== "24h"
                  ? "Try clearing search, widening the range, or switching level."
                  : "Lucky day. Recent errors will appear here as they're logged."
              }
              action={
                q || level !== "error" || range !== "24h" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setLevel("error");
                      setRange("24h");
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
              {data.rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.id)}
                    className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/30 ${
                      selected === row.id ? "bg-accent/40" : ""
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        row.level === "warning" ? "bg-amber-500" : "bg-red-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.message}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {row.route ?? "-"} · v{row.app_version ?? "?"} ·{" "}
                        {new Date(row.created_at).toLocaleString()}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data && data.rows.length > 0 && (
            <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-[11px] tabular-nums text-muted-foreground">
              <span>
                Showing {(data.page - 1) * data.per + 1}–
                {Math.min(data.page * data.per, data.total)} of{" "}
                {data.total.toLocaleString()}
              </span>
              <AdminPagination
                page={data.page}
                totalPages={Math.max(1, Math.ceil(data.total / data.per))}
                onPageChange={setPage}
              />
            </footer>
          )}
        </div>

        {/* Detail drawer */}
        <aside className="rounded-lg border border-border/60 bg-card p-4 lg:sticky lg:top-20 lg:self-start">
          {!selectedRow ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Select an event to see the stack and context.
            </p>
          ) : (
            <DetailPanel
              row={selectedRow}
              onFindRelated={(message) => {
                setQ(message.slice(0, 80));
                setPage(1);
              }}
            />
          )}
        </aside>
      </div>
    </div>
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
            // `whitespace-nowrap` keeps labels like "Last 7 days"
            // on a single line; without it the text wrapped inside
            // a 28 px chip and overflowed below the bottom border.
            // The outer flex-wrap lets the chip row break to a
            // second line on narrow viewports instead.
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
  onFindRelated,
}: {
  row: ErrorRow;
  /** Click handler for the "find similar" affordance - typically
   *  the parent setting the search input to this row's message. */
  onFindRelated?: (q: string) => void;
}) {
  // `_traced_user` is the marker the error reporter writes into
  // context for admin-traced users (see lib/error-reporter.ts).
  // When present we surface a Pill + a deep-link to the user
  // detail page so the operator can pivot without rummaging
  // through the JSON.
  const tracedUserId =
    row.context && typeof row.context._traced_user === "string"
      ? row.context._traced_user
      : null;
  return (
    <div className="space-y-3 text-xs">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Pill tone={row.level === "warning" ? "amber" : "red"}>
            {row.level}
          </Pill>
          {tracedUserId && <Pill tone="amber">traced</Pill>}
        </div>
        <p className="break-words text-sm font-medium">{row.message}</p>
        {onFindRelated && (
          <button
            type="button"
            onClick={() => onFindRelated(row.message)}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Find similar errors →
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <DetailRow
          label="When"
          value={new Date(row.created_at).toLocaleString()}
        />
        <DetailRow
          label="App"
          value={`v${row.app_version ?? "?"}`}
        />
        <DetailRow
          label="Route"
          value={row.route ?? "-"}
          mono
        />
        <DetailRow
          label="Session"
          value={row.session_token ?? "-"}
          mono
        />
      </dl>

      {row.user_agent && (
        <DetailRow
          label="User agent"
          value={row.user_agent}
          mono
          wrap
        />
      )}

      {tracedUserId && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px]">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            Traced user
          </p>
          <p className="mt-0.5 text-muted-foreground">
            This event was captured with expanded context because the user is
            flagged for tracing.
          </p>
          <Link
            href={`/admin/users/${tracedUserId}`}
            className="mt-1 inline-flex items-center text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
          >
            Open user →
          </Link>
        </div>
      )}

      {row.context && Object.keys(row.context).length > 0 && (
        <JsonViewer
          label="Context"
          value={row.context}
        />
      )}

      {row.stack && (
        <CodeBlock
          label="Stack trace"
          copy={row.stack}
        >
          {row.stack}
        </CodeBlock>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  wrap = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words text-[11px] ${
          mono ? "font-mono text-[10px]" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
