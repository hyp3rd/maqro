import { CopyableId } from "@/components/admin/CopyableId";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pill } from "@/components/admin/Pill";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import {
  ChevronLeft,
  ChevronRight,
  History,
  LogIn,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

/** Audit log viewer — two sources, switched via `?source=`:
 *
 *    - `app` (default) — our `admin_audit_log` table (admin actions
 *      performed inside this app: role changes, account deletes,
 *      webhook replays, etc.). Authoritative for "what did our
 *      admins do?"
 *    - `auth` — Supabase's auth audit trail (login, logout, signup,
 *      MFA enroll, token refresh, password change, user_modified,
 *      …). Backed by `public.auth_audit_events` (migration 0032).
 *
 *  Server-rendered with filters + pagination driven entirely via
 *  URL search params, so the back/forward stack works, deep-links
 *  to a specific filtered slice are shareable with another admin,
 *  and we don't have to ship a client-side fetcher for what is
 *  fundamentally a read-only paginated log. Filter changes hit
 *  the route as Link clicks — Next.js streams the new partial
 *  render with no client JS hand-off. */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type Source = "app" | "auth";

type Range = "1h" | "24h" | "7d" | "30d" | "all";

const RANGES: Record<Range, number | null> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
  all: null,
};

const RANGE_LABELS: Record<Range, string> = {
  "1h": "Last hour",
  "24h": "Last 24h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

type AppAuditRow = {
  id: string;
  created_at: string;
  admin_user_id: string;
  target_user_id: string | null;
  action: string;
  payload: Record<string, unknown> | null;
};

type AuthAuditRow = {
  id: string;
  created_at: string;
  ip_address: string | null;
  payload: {
    action?: string;
    actor_id?: string;
    actor_username?: string;
    actor_via_sso?: boolean;
    log_type?: string;
    traits?: Record<string, unknown>;
  } | null;
};

function adminClient() {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  return createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseSource(raw: string | string[] | undefined): Source {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "auth" ? "auth" : "app";
}

function parseRange(raw: string | string[] | undefined): Range {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v in RANGES ? (v as Range) : "7d";
}

function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v ?? "1");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function parseAction(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v?.trim() ?? "";
}

function buildHref(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== "") usp.set(k, v);
  }
  return `/admin/audit${usp.toString() ? `?${usp.toString()}` : ""}`;
}

async function loadAppRows(
  range: Range,
  action: string,
  page: number,
): Promise<{ rows: AppAuditRow[]; total: number } | null> {
  const admin = adminClient();
  if (!admin) return null;
  // Two phases: (a) `count: exact` for the pager UI, and (b) the
  // slice the user actually sees. Could collapse to a single
  // query with the count header, but separating keeps the slice
  // query simple to read.
  let countQ = admin
    .from("admin_audit_log")
    .select("id", { count: "exact", head: true });
  let rowsQ = admin
    .from("admin_audit_log")
    .select("id, created_at, admin_user_id, target_user_id, action, payload")
    .order("created_at", { ascending: false });
  const ms = RANGES[range];
  if (ms !== null) {
    const cutoff = new Date(Date.now() - ms).toISOString();
    countQ = countQ.gte("created_at", cutoff);
    rowsQ = rowsQ.gte("created_at", cutoff);
  }
  if (action) {
    // `like` with a trailing wildcard lets the operator filter by
    // prefix (e.g. `user.` to see every user-scoped action).
    countQ = countQ.like("action", `${action}%`);
    rowsQ = rowsQ.like("action", `${action}%`);
  }
  const [{ count }, { data }] = await Promise.all([
    countQ,
    rowsQ.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);
  return { rows: (data as AppAuditRow[] | null) ?? [], total: count ?? 0 };
}

async function loadAuthRows(
  range: Range,
  action: string,
  page: number,
): Promise<
  | { rows: AuthAuditRow[]; total: number; error: null }
  | { rows: []; total: 0; error: string }
  | null
> {
  const admin = adminClient();
  if (!admin) return null;
  let countQ = admin
    .from("auth_audit_events")
    .select("id", { count: "exact", head: true });
  let rowsQ = admin
    .from("auth_audit_events")
    .select("id, created_at, ip_address, payload")
    .order("created_at", { ascending: false });
  const ms = RANGES[range];
  if (ms !== null) {
    const cutoff = new Date(Date.now() - ms).toISOString();
    countQ = countQ.gte("created_at", cutoff);
    rowsQ = rowsQ.gte("created_at", cutoff);
  }
  if (action) {
    // payload->>action is a JSONB extraction; `ilike` for a
    // case-insensitive prefix match. The view exposes payload as
    // jsonb so the operator can poke at any action name without
    // needing a generated column.
    countQ = countQ.ilike("payload->>action", `${action}%`);
    rowsQ = rowsQ.ilike("payload->>action", `${action}%`);
  }
  const [countRes, rowsRes] = await Promise.all([
    countQ,
    rowsQ.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);
  if (countRes.error || rowsRes.error) {
    return {
      rows: [],
      total: 0,
      error: (countRes.error ?? rowsRes.error)?.message ?? "Unknown error",
    };
  }
  return {
    rows: (rowsRes.data as AuthAuditRow[] | null) ?? [],
    total: countRes.count ?? 0,
    error: null,
  };
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    redirect("/app");
  }
  const params = await searchParams;
  const source = parseSource(params.source);
  const range = parseRange(params.range);
  const action = parseAction(params.action);
  const page = parsePage(params.page);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={History}
        title="Audit log"
        description={`Filter by action prefix or time window. ${PAGE_SIZE} rows per page.`}
      />
      <Tabs
        active={source}
        range={range}
        action={action}
      />

      <FilterBar
        source={source}
        action={action}
        range={range}
      />

      {source === "app" ? (
        <AppTable
          range={range}
          action={action}
          page={page}
        />
      ) : (
        <AuthTable
          range={range}
          action={action}
          page={page}
        />
      )}
    </div>
  );
}

function Tabs({
  active,
  range,
  action,
}: {
  active: Source;
  range: Range;
  action: string;
}) {
  const items: { source: Source; label: string; icon: typeof ShieldAlert }[] = [
    { source: "app", label: "Admin actions", icon: ShieldAlert },
    { source: "auth", label: "Auth events", icon: LogIn },
  ];
  return (
    <nav
      aria-label="Audit log source"
      className="flex items-center gap-1 border-b border-border/60"
    >
      {items.map((item) => {
        const isActive = item.source === active;
        const Icon = item.icon;
        return (
          <Link
            key={item.source}
            href={buildHref({ source: item.source, range, action, page: "1" })}
            aria-current={isActive ? "page" : undefined}
            className={`relative -mb-px inline-flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs transition-colors ${
              isActive
                ? "border-x border-t border-border/60 bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function FilterBar({
  source,
  action,
  range,
}: {
  source: Source;
  action: string;
  range: Range;
}) {
  // GET form so changes navigate through search params — keeps
  // the page server-rendered and links sharable. The `source` is
  // a hidden field so switching range/action doesn't drop the
  // current tab.
  return (
    <form
      method="get"
      action="/admin/audit"
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <input
        type="hidden"
        name="source"
        value={source}
      />
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Action prefix
        </span>
        <input
          name="action"
          type="search"
          defaultValue={action}
          placeholder={source === "app" ? "e.g. user." : "e.g. login"}
          className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs font-mono"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Range
        </span>
        <select
          name="range"
          defaultValue={range}
          className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs"
        >
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <option
              key={r}
              value={r}
            >
              {RANGE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-1 sm:ml-auto sm:self-end">
        <Button
          type="submit"
          size="sm"
          className="h-8"
        >
          Apply
        </Button>
        <Link
          href={buildHref({ source })}
          className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs hover:bg-accent"
        >
          Reset
        </Link>
      </div>
    </form>
  );
}

async function AppTable({
  range,
  action,
  page,
}: {
  range: Range;
  action: string;
  page: number;
}) {
  const result = await loadAppRows(range, action, page);
  if (result === null) return <UnconfiguredMessage />;
  if (result.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-card">
        <EmptyState
          icon={ShieldAlert}
          title={
            action || range !== "7d"
              ? "No matching admin actions"
              : "No admin actions yet"
          }
          description={
            action || range !== "7d"
              ? "Try widening the range or clearing the action filter."
              : "Role changes, bans, and webhook replays will show up here."
          }
        />
      </div>
    );
  }
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  return (
    <div className="space-y-3">
      <ResultBar
        total={result.total}
        rangeLabel={RANGE_LABELS[range]}
      />
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">When</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Admin</th>
                <th className="px-4 py-2 text-left font-medium">Target</th>
                <th className="px-4 py-2 text-left font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {result.rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-accent/30"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <Pill tone={actionTone(row.action)}>{row.action}</Pill>
                  </td>
                  <td className="px-4 py-2.5">
                    <CopyableId value={row.admin_user_id} />
                  </td>
                  <td className="px-4 py-2.5">
                    {row.target_user_id ? (
                      <Link
                        href={`/admin/users/${row.target_user_id}`}
                        className="inline-flex items-center"
                      >
                        <CopyableId value={row.target_user_id} />
                      </Link>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
                    {row.payload ? (
                      <span
                        className="block max-w-[16rem] truncate"
                        title={JSON.stringify(row.payload)}
                      >
                        {JSON.stringify(row.payload)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pager
        page={page}
        totalPages={totalPages}
        source="app"
        range={range}
        action={action}
      />
    </div>
  );
}

async function AuthTable({
  range,
  action,
  page,
}: {
  range: Range;
  action: string;
  page: number;
}) {
  const result = await loadAuthRows(range, action, page);
  if (result === null) return <UnconfiguredMessage />;
  if (result.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-700 dark:text-red-300"
      >
        Couldn&apos;t load Supabase auth events: {result.error}
        <br />
        If the message says{" "}
        <code className="font-mono">
          relation &quot;auth_audit_events&quot; does not exist
        </code>
        , the 0032 migration hasn&apos;t been applied to this deployment yet —
        run <code className="font-mono">supabase db push</code>.
      </p>
    );
  }
  if (result.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-card">
        <EmptyState
          icon={LogIn}
          title={
            action || range !== "7d"
              ? "No matching auth events"
              : "No auth events yet"
          }
          description={
            action || range !== "7d"
              ? "Try widening the range or clearing the action filter."
              : "Login, signup, MFA enroll, and password-change events will show up here."
          }
        />
      </div>
    );
  }
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  return (
    <div className="space-y-3">
      <ResultBar
        total={result.total}
        rangeLabel={RANGE_LABELS[range]}
      />
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">When</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">User</th>
                <th className="px-4 py-2 text-left font-medium">IP</th>
                <th className="px-4 py-2 text-left font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {result.rows.map((row) => {
                const payload = row.payload ?? {};
                const username = payload.actor_username ?? null;
                const actorId = payload.actor_id ?? null;
                const actionStr = payload.action ?? "unknown";
                const logType = payload.log_type;
                const detail = payload.traits;
                return (
                  <tr
                    key={row.id}
                    className="transition-colors hover:bg-accent/30"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Pill tone={authActionTone(actionStr)}>
                          {actionStr}
                        </Pill>
                        {logType && (
                          <span className="text-[10px] text-muted-foreground">
                            {logType}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[11px]">
                      {username ? (
                        <span>{username}</span>
                      ) : actorId ? (
                        <CopyableId value={actorId} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
                      {row.ip_address ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
                      {detail && Object.keys(detail).length > 0 ? (
                        <span
                          className="block max-w-[16rem] truncate"
                          title={JSON.stringify(detail)}
                        >
                          {JSON.stringify(detail)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pager
        page={page}
        totalPages={totalPages}
        source="auth"
        range={range}
        action={action}
      />
    </div>
  );
}

function ResultBar({
  total,
  rangeLabel,
}: {
  total: number;
  rangeLabel: string;
}) {
  return (
    <p className="text-[11px] text-muted-foreground">
      <span className="font-mono tabular-nums">{total.toLocaleString()}</span>{" "}
      {total === 1 ? "row" : "rows"} · {rangeLabel}
    </p>
  );
}

function Pager({
  page,
  totalPages,
  source,
  range,
  action,
}: {
  page: number;
  totalPages: number;
  source: Source;
  range: Range;
  action: string;
}) {
  if (totalPages <= 1) return null;
  const atFirst = page <= 1;
  const atLast = page >= totalPages;
  return (
    <div className="flex items-center justify-end gap-2 text-xs">
      <Link
        href={buildHref({
          source,
          range,
          action,
          page: String(Math.max(1, page - 1)),
        })}
        aria-disabled={atFirst}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-input coarse:h-11 coarse:w-11 ${
          atFirst
            ? "pointer-events-none opacity-40"
            : "hover:bg-accent hover:text-foreground"
        }`}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Link>
      <span className="font-mono tabular-nums text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Link
        href={buildHref({
          source,
          range,
          action,
          page: String(Math.min(totalPages, page + 1)),
        })}
        aria-disabled={atLast}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-input coarse:h-11 coarse:w-11 ${
          atLast
            ? "pointer-events-none opacity-40"
            : "hover:bg-accent hover:text-foreground"
        }`}
        aria-label="Next page"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

/** Map an action string to a Pill tone. Destructive actions
 *  (ban, force-delete) get red; user-scoped get blue; everything
 *  else stays neutral. Centralized so a future action set lands
 *  consistently. */
function actionTone(action: string): "red" | "blue" | "amber" | "muted" {
  if (/ban|delete|force/.test(action)) return "red";
  if (action.startsWith("user.")) return "blue";
  if (action.includes("replay")) return "amber";
  return "muted";
}

function authActionTone(action: string): "emerald" | "red" | "amber" | "muted" {
  if (action === "login") return "emerald";
  if (action === "logout") return "muted";
  if (action.includes("fail") || action.includes("revoke")) return "red";
  if (action.includes("recovery") || action.includes("token_refresh"))
    return "amber";
  return "muted";
}

function UnconfiguredMessage() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-card">
      <EmptyState
        icon={History}
        title="Service-role key not configured"
        description="Set SUPABASE_SECRET_KEY on this deployment to enable the audit log viewer."
      />
    </div>
  );
}
