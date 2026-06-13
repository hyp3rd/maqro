"use client";

import { AdminPagination } from "@/components/admin/AdminPagination";
import { CopyableId } from "@/components/admin/CopyableId";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pill } from "@/components/admin/Pill";
import { NumberTicker } from "@/components/shell/NumberTicker";
import { Button } from "@/components/ui/button";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import { Input } from "@/components/ui/input";
import { clientFetch } from "@/lib/auth/client-fetch";
import { haptic } from "@/lib/haptics";
import { useEffect, useState } from "react";
import {
  Ban,
  ExternalLink,
  Loader2,
  Radio,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

type AdminUserRow = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  role: "user" | "admin";
  is_premium: boolean;
  subscription_status: string | null;
  stripe_price_id: string | null;
  banned_until: string | null;
  /** Server-computed: ban exists AND hasn't expired yet. We rely
   *  on this rather than re-computing on the client so render
   *  stays pure (no `Date.now()` calls in the row map). */
  is_banned: boolean;
  traced: boolean;
};

type ListResponse = {
  rows: AdminUserRow[];
  total: number;
  page: number;
  per: number;
  filter: UserFilter;
};

type UserFilter = "all" | "premium" | "free" | "banned" | "traced";

const FILTER_LABELS: Record<UserFilter, string> = {
  all: "All",
  premium: "Premium",
  free: "Free",
  banned: "Banned",
  traced: "Traced",
};

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [page, setPage] = useState(1);
  // Single discriminated-union state so we don't have to flip
  // loading/error/data in separate setState calls inside the
  // effect (which the react-hooks/set-state-in-effect rule
  // rightly flags as a smell). Keeping the previous data
  // visible during a re-fetch is also nicer UX than a spinner
  // flash on every search keystroke.
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; data: ListResponse }
    | { status: "error"; message: string }
  >({ status: "loading" });
  // Bumping `tick` triggers a re-fetch — used after a successful
  // role / usage change to refresh the list.
  const [tick, setTick] = useState(0);
  // Per-row in-flight lock so rapid clicks can't race a promote against a
  // demote (or double-fire a usage reset). Holds the row id + which action.
  const [busy, setBusy] = useState<{
    id: string;
    action: "role" | "usage";
  } | null>(null);
  // Promote is the one irreversible-feeling, security-sensitive action here
  // (it grants full admin over everyone). Demote stays a direct click.
  const [pendingPromote, setPendingPromote] = useState<AdminUserRow | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), per: "25" });
    if (query.trim()) params.set("q", query.trim());
    if (filter !== "all") params.set("filter", filter);
    clientFetch(`/api/admin/users?${params.toString()}`)
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
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Network error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, filter, page, tick]);

  const loading = state.status === "loading";
  const error = state.status === "error" ? state.message : null;
  const data = state.status === "ok" ? state.data : null;

  async function changeRole(userId: string, role: "user" | "admin") {
    setBusy({ id: userId, action: "role" });
    try {
      const res = await clientFetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't change role.");
        return;
      }
      haptic("success");
      toast.success(`Role set to ${role}`);
      setTick((t) => t + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change role.");
    } finally {
      setBusy(null);
    }
  }

  async function resetUsage(userId: string) {
    setBusy({ id: userId, action: "usage" });
    try {
      const res = await clientFetch(`/api/admin/users/${userId}/usage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 0 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't reset usage.");
        return;
      }
      haptic("success");
      toast.success("AI usage reset for this month");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset usage.");
    } finally {
      setBusy(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Users}
        title="Users"
        description="Search, filter, ban, trace, and adjust subscriptions across the user base."
        tone="blue"
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by email…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>
        {/* Status filter chips — search composes with filter so an
         *  operator can search across the filtered slice (e.g. find
         *  every banned user matching "@example.com"). Clicking a
         *  chip resets pagination since the result set shape may
         *  change dramatically. */}
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(FILTER_LABELS) as UserFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        {data && (
          <p className="text-[11px] tabular-nums text-muted-foreground sm:ml-auto">
            <NumberTicker value={data.total} /> total
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

      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </p>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={query || filter !== "all" ? "No matches" : "No users"}
            description={
              query || filter !== "all"
                ? "Try clearing the search or switching filters."
                : "Users will appear here as they sign up."
            }
            action={
              query || filter !== "all" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {/* Mobile: stacked-card list. Tables don't fit five
             *  columns on a phone — the screenshot showed JOINED
             *  clipped and the Actions column entirely off-screen.
             *  Each row is the same tap target as the desktop link
             *  (whole card → /admin/users/[id]); per-row bulk
             *  actions move to the detail page on mobile where they
             *  have room to breathe. */}
            <ul className="divide-y divide-border/60 sm:hidden">
              {data.rows.map((u) => {
                const isBanned = u.is_banned;
                return (
                  <li key={u.id}>
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="block px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">
                          {u.email ?? "—"}
                        </p>
                        <time
                          dateTime={u.created_at}
                          className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                          {new Date(u.created_at).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", year: "2-digit" },
                          )}
                        </time>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {u.role === "admin" && (
                          <Pill
                            tone="blue"
                            icon={ShieldCheck}
                          >
                            admin
                          </Pill>
                        )}
                        {u.is_premium ? (
                          <Pill tone="emerald">premium</Pill>
                        ) : (
                          <Pill tone="muted">free</Pill>
                        )}
                        {u.subscription_status &&
                          u.subscription_status !== "active" && (
                            <Pill tone="amber">
                              {u.subscription_status.replace(/_/g, " ")}
                            </Pill>
                          )}
                        {isBanned && (
                          <Pill
                            tone="red"
                            icon={Ban}
                          >
                            banned
                          </Pill>
                        )}
                        {u.traced && (
                          <Pill
                            tone="amber"
                            icon={Radio}
                          >
                            traced
                          </Pill>
                        )}
                      </div>
                      <div className="mt-1.5">
                        <CopyableId value={u.id} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* sm+: full table with inline bulk actions. */}
            <table className="hidden w-full text-sm sm:table">
              <thead className="border-b border-border/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Email</th>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2 text-left font-medium">Plan</th>
                  <th className="px-4 py-2 text-left font-medium">Joined</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.rows.map((u) => {
                  const isBanned = u.is_banned;
                  return (
                    <tr
                      key={u.id}
                      className="transition-colors hover:bg-accent/30"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="text-sm underline-offset-2 hover:underline"
                          >
                            {u.email ?? "—"}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1">
                            <CopyableId value={u.id} />
                            {isBanned && (
                              <Pill
                                tone="red"
                                icon={Ban}
                              >
                                banned
                              </Pill>
                            )}
                            {u.traced && (
                              <Pill
                                tone="amber"
                                icon={Radio}
                              >
                                traced
                              </Pill>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {u.role === "admin" ? (
                          <Pill
                            tone="blue"
                            icon={ShieldCheck}
                          >
                            admin
                          </Pill>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            user
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {u.is_premium ? (
                            <Pill tone="emerald">premium</Pill>
                          ) : (
                            <Pill tone="muted">free</Pill>
                          )}
                          {u.subscription_status &&
                            u.subscription_status !== "active" && (
                              <Pill tone="amber">
                                {u.subscription_status.replace(/_/g, " ")}
                              </Pill>
                            )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px]"
                            disabled={busy?.id === u.id}
                            onClick={() => {
                              // Demote is a direct click; promote opens a
                              // confirm (it grants full admin).
                              if (u.role === "admin") {
                                void changeRole(u.id, "user");
                              } else {
                                setPendingPromote(u);
                              }
                            }}
                          >
                            {busy?.id === u.id && busy.action === "role" && (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            )}
                            {u.role === "admin" ? "Demote" : "Promote"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px]"
                            disabled={busy?.id === u.id}
                            onClick={() => void resetUsage(u.id)}
                          >
                            {busy?.id === u.id && busy.action === "usage" && (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            )}
                            Reset AI
                          </Button>
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            title="Open user detail"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {data && (
        <AdminPagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}

      <DestructiveConfirmDialog
        open={pendingPromote !== null}
        onOpenChange={(o) => {
          if (!o) setPendingPromote(null);
        }}
        title={`Promote ${pendingPromote?.email ?? "this user"} to admin?`}
        description="Admins can ban, trace, delete accounts, and change billing for every user. Grant this only to trusted operators."
        actionLabel="Promote"
        onConfirm={() => {
          if (pendingPromote) {
            haptic("warning");
            void changeRole(pendingPromote.id, "admin");
          }
          setPendingPromote(null);
        }}
      />
    </div>
  );
}
